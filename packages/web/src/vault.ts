import {
  createVaultKey,
  decryptFile,
  decryptItem,
  deriveKeyFromPasskeySecret,
  deriveKeyFromPassword,
  encodePublicKey,
  encryptFile,
  encryptItem,
  fromUtf8,
  generatePersonKeyPair,
  generateRecoveryCode,
  recoveryKeyFromCode,
  recoveryVerifier,
  reencryptItem,
  unwrapItemKey,
  unwrapVaultKey,
  utf8,
  wrapPrivateKey,
  wrapVaultKey,
  type EncryptedItem,
  type Envelope,
} from '@memoriae/crypto';
import { api, type Accesso, type CassaforteRemota, type TipoVoce, type VoceRemota } from './api';

/** Contenuto di una voce come lo vede l'utente (esiste solo nel browser). */
export type AzioneAccount = 'conservare' | 'trasmettere' | 'cancellare';

export interface ContenutoVoce {
  titolo: string;
  note: string;
  fornitore?: string;
  /** Volontà: a chi va questa voce (id delle persone) e cosa fare dell'account. Restano cifrate. */
  destinatari?: string[];
  azione?: AzioneAccount;
  /** Documenti allegati: nome e tipo restano cifrati qui; il server vede solo id e dimensione. */
  files?: FileVoce[];
  /** Versione precedente: un solo documento, con lo stesso id della voce. */
  file?: { nome: string; tipo: string; dimensione: number };
}

export interface FileVoce {
  id: string;
  nome: string;
  tipo: string;
  dimensione: number;
}

/** Tutti i documenti di una voce, compreso quello della versione precedente. */
export function documentiDi(itemId: string, c: ContenutoVoce): FileVoce[] {
  if (c.files) return c.files;
  return c.file ? [{ id: itemId, ...c.file }] : [];
}

/** Contesto di cifratura di un file: lega il file alla sua voce e al suo posto. */
export const contestoFile = (itemId: string, fileId: string) => (fileId === itemId ? itemId : `${itemId}/${fileId}`);

export const MAX_DOCUMENTI = 20;

export interface Voce {
  id: string;
  tipo: TipoVoce;
  emergenza: boolean;
  contenuto: ContenutoVoce;
  remota: VoceRemota;
}

export type SegretoAccesso = { tipo: 'passkey'; credentialId: string; prf: Uint8Array } | { tipo: 'password'; password: string };

/** Crea la cassaforte: tutte le chiavi nascono qui e il server riceve solo copie cifrate. */
export async function creaCassaforte(segreto: SegretoAccesso): Promise<{ vaultId: string; vaultKey: Uint8Array; codiceRecupero: string }> {
  const vaultId = crypto.randomUUID();
  const vaultKey = await createVaultKey();
  const persona = await generatePersonKeyPair();
  const recupero = await generateRecoveryCode();

  const accessi: Accesso[] = [];
  if (segreto.tipo === 'passkey') {
    const k = await deriveKeyFromPasskeySecret(segreto.prf);
    accessi.push({ metodo: 'passkey', credentialId: segreto.credentialId, chiaveCifrata: await wrapVaultKey(vaultKey, k, vaultId, 'passkey') });
  } else {
    const { key, params } = await deriveKeyFromPassword(segreto.password);
    accessi.push({ metodo: 'password', parametri: params, chiaveCifrata: await wrapVaultKey(vaultKey, key, vaultId, 'password') });
  }
  accessi.push({ metodo: 'recovery-code', chiaveCifrata: await wrapVaultKey(vaultKey, recupero.key, vaultId, 'recovery-code') });

  await api.creaCassaforte({
    id: vaultId,
    chiavePubblica: await encodePublicKey(persona.publicKey),
    chiavePrivataCifrata: await wrapPrivateKey(persona.privateKey, vaultKey, 'owner'),
    accessi,
    verificaRecupero: await recoveryVerifier(recupero.key),
  });
  return { vaultId, vaultKey, codiceRecupero: recupero.code };
}

/** Quale metodo serve per aprire questa cassaforte con questa passkey? */
export function metodoPer(remota: CassaforteRemota, credentialId: string): 'passkey' | 'password' | null {
  if (remota.accessi.some((a) => a.metodo === 'passkey' && a.credentialId === credentialId)) return 'passkey';
  if (remota.accessi.some((a) => a.metodo === 'password')) return 'password';
  return null;
}

export async function apriConPasskey(remota: CassaforteRemota, credentialId: string, prf: Uint8Array): Promise<Uint8Array> {
  const a = remota.accessi.find((x) => x.metodo === 'passkey' && x.credentialId === credentialId);
  if (!a) throw new Error('Questa passkey non apre la cassaforte');
  return unwrapVaultKey(a.chiaveCifrata, await deriveKeyFromPasskeySecret(prf), remota.id, 'passkey');
}

export async function apriConPassword(remota: CassaforteRemota, password: string): Promise<Uint8Array> {
  const a = remota.accessi.find((x) => x.metodo === 'password');
  if (!a?.parametri) throw new Error('Nessuna password impostata');
  const { key } = await deriveKeyFromPassword(password, a.parametri);
  try {
    return await unwrapVaultKey(a.chiaveCifrata, key, remota.id, 'password');
  } catch {
    throw new Error('Password errata');
  }
}

/** Recupero: il codice stampato apre la cassaforte qui nel browser; al server va solo il verificatore. */
export async function apriConCodiceRecupero(
  vaultId: string,
  chiaveCifrata: Envelope,
  codice: string,
): Promise<{ vaultKey: Uint8Array; verificatore: string }> {
  let key: Uint8Array;
  try {
    key = await recoveryKeyFromCode(codice);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Codice di recupero non valido');
  }
  try {
    const vaultKey = await unwrapVaultKey(chiaveCifrata, key, vaultId, 'recovery-code');
    return { vaultKey, verificatore: await recoveryVerifier(key) };
  } catch {
    throw new Error('Il codice di recupero non apre questa cassaforte: controlla di averlo ricopiato bene');
  }
}

/** Dopo un recupero: la nuova passkey (o una nuova password) riceve il proprio accesso alla cassaforte. */
export async function aggiungiAccesso(vaultId: string, vaultKey: Uint8Array, segreto: SegretoAccesso): Promise<void> {
  if (segreto.tipo === 'passkey') {
    const k = await deriveKeyFromPasskeySecret(segreto.prf);
    await api.sostituisciAccesso({ metodo: 'passkey', credentialId: segreto.credentialId, chiaveCifrata: await wrapVaultKey(vaultKey, k, vaultId, 'passkey') });
  } else {
    const { key, params } = await deriveKeyFromPassword(segreto.password);
    await api.sostituisciAccesso({ metodo: 'password', parametri: params, chiaveCifrata: await wrapVaultKey(vaultKey, key, vaultId, 'password') });
  }
}

function comeEncrypted(v: VoceRemota): EncryptedItem {
  return { itemId: v.id, wrappedItemKey: v.chiaveVoceCifrata, content: v.contenuto };
}

export async function leggiVoci(vaultKey: Uint8Array): Promise<Voce[]> {
  const { voci } = await api.voci();
  return Promise.all(
    voci.map(async (r) => {
      const enc = comeEncrypted(r);
      const k = await unwrapItemKey(vaultKey, enc);
      const contenuto = JSON.parse(fromUtf8(await decryptItem(k, enc))) as ContenutoVoce;
      return { id: r.id, tipo: r.tipo, emergenza: r.emergenza, contenuto, remota: r };
    }),
  );
}

const metaFile = (f: File): FileVoce => ({ id: crypto.randomUUID(), nome: f.name, tipo: f.type || 'application/octet-stream', dimensione: f.size });

async function caricaDocumenti(itemId: string, itemKey: Uint8Array, files: File[], meta: FileVoce[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const bytes = new Uint8Array(await files[i]!.arrayBuffer());
    await api.caricaFile(itemId, meta[i]!.id, await encryptFile(itemKey, contestoFile(itemId, meta[i]!.id), bytes));
  }
}

export async function aggiungiVoce(
  vaultKey: Uint8Array,
  dati: { tipo: TipoVoce; emergenza: boolean; titolo: string; note: string; fornitore?: string; files?: File[] },
): Promise<void> {
  const id = crypto.randomUUID();
  const files = dati.files ?? [];
  const meta = files.map(metaFile);
  const contenuto: ContenutoVoce = {
    titolo: dati.titolo,
    note: dati.note,
    ...(dati.fornitore ? { fornitore: dati.fornitore } : {}),
    ...(meta.length ? { files: meta } : {}),
  };
  const { item, itemKey } = await encryptItem(vaultKey, id, utf8(JSON.stringify(contenuto)));
  await api.creaVoce({ id, tipo: dati.tipo, emergenza: dati.emergenza, chiaveVoceCifrata: item.wrappedItemKey, contenuto: item.content });
  await caricaDocumenti(id, itemKey, files, meta);
}

/** Aggiunge documenti a una voce esistente. */
export async function aggiungiDocumenti(vaultKey: Uint8Array, voce: Voce, files: File[]): Promise<void> {
  const attuali = documentiDi(voce.id, voce.contenuto);
  if (attuali.length + files.length > MAX_DOCUMENTI) throw new Error(`Al massimo ${MAX_DOCUMENTI} documenti per voce`);
  const k = await unwrapItemKey(vaultKey, comeEncrypted(voce.remota));
  const meta = files.map(metaFile);
  // Prima i file, poi l'elenco: se il caricamento si interrompe, la voce non punta a file mancanti.
  await caricaDocumenti(voce.id, k, files, meta);
  const { file: _vecchio, ...resto } = voce.contenuto;
  await aggiornaVoce(vaultKey, voce, { ...resto, files: [...attuali, ...meta] }, voce.emergenza);
}

/** Toglie un documento da una voce. */
export async function rimuoviDocumento(vaultKey: Uint8Array, voce: Voce, fileId: string): Promise<void> {
  const { file: _vecchio, ...resto } = voce.contenuto;
  await aggiornaVoce(vaultKey, voce, { ...resto, files: documentiDi(voce.id, voce.contenuto).filter((f) => f.id !== fileId) }, voce.emergenza);
  await api.eliminaFile(voce.id, fileId);
}

/** Aggiorna il contenuto (per esempio le volontà) mantenendo la chiave della voce. */
export async function aggiornaVoce(vaultKey: Uint8Array, voce: Voce, contenuto: ContenutoVoce, emergenza: boolean): Promise<void> {
  const enc = comeEncrypted(voce.remota);
  const k = await unwrapItemKey(vaultKey, enc);
  const updated = await reencryptItem(k, enc, utf8(JSON.stringify(contenuto)));
  await api.modificaVoce(voce.id, { contenuto: updated.content, emergenza });
}

export async function chiaveVoce(vaultKey: Uint8Array, voce: Voce): Promise<Uint8Array> {
  return unwrapItemKey(vaultKey, comeEncrypted(voce.remota));
}

export async function scaricaFile(vaultKey: Uint8Array, voce: Voce, f: FileVoce): Promise<void> {
  const k = await unwrapItemKey(vaultKey, comeEncrypted(voce.remota));
  const bytes = await decryptFile(k, contestoFile(voce.id, f.id), await api.scaricaFile(voce.id, f.id));
  const blob = new Blob([bytes.slice().buffer], { type: f.tipo || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.nome || 'documento';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
