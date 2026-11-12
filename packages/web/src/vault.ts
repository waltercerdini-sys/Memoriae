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
  unwrapItemKey,
  unwrapVaultKey,
  utf8,
  wrapPrivateKey,
  wrapVaultKey,
  type EncryptedItem,
} from '@memoriae/crypto';
import { api, type Accesso, type CassaforteRemota, type TipoVoce, type VoceRemota } from './api';

/** Contenuto di una voce come lo vede l'utente (esiste solo nel browser). */
export interface ContenutoVoce {
  titolo: string;
  note: string;
  fornitore?: string;
  file?: { nome: string; tipo: string; dimensione: number };
}

export interface Voce {
  id: string;
  tipo: TipoVoce;
  emergenza: boolean;
  contenuto: ContenutoVoce;
  haFile: boolean;
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
      return { id: r.id, tipo: r.tipo, emergenza: r.emergenza, contenuto, haFile: r.haFile, remota: r };
    }),
  );
}

export async function aggiungiVoce(
  vaultKey: Uint8Array,
  dati: { tipo: TipoVoce; emergenza: boolean; titolo: string; note: string; fornitore?: string; file?: File | null },
): Promise<void> {
  const id = crypto.randomUUID();
  const contenuto: ContenutoVoce = {
    titolo: dati.titolo,
    note: dati.note,
    ...(dati.fornitore ? { fornitore: dati.fornitore } : {}),
    ...(dati.file ? { file: { nome: dati.file.name, tipo: dati.file.type || 'application/octet-stream', dimensione: dati.file.size } } : {}),
  };
  const { item, itemKey } = await encryptItem(vaultKey, id, utf8(JSON.stringify(contenuto)));
  await api.creaVoce({ id, tipo: dati.tipo, emergenza: dati.emergenza, chiaveVoceCifrata: item.wrappedItemKey, contenuto: item.content });
  if (dati.file) {
    const bytes = new Uint8Array(await dati.file.arrayBuffer());
    await api.caricaFile(id, await encryptFile(itemKey, id, bytes));
  }
}

export async function scaricaFile(vaultKey: Uint8Array, voce: Voce): Promise<void> {
  const k = await unwrapItemKey(vaultKey, comeEncrypted(voce.remota));
  const bytes = await decryptFile(k, voce.id, await api.scaricaFile(voce.id));
  const blob = new Blob([bytes.slice().buffer], { type: voce.contenuto.file?.tipo ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = voce.contenuto.file?.nome ?? 'documento';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
