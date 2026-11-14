import {
  decryptFile,
  decryptItem,
  decodePublicKey,
  deriveReleaseKeyAtActivation,
  fromUtf8,
  openPackageInner,
  openPackageOuter,
  unwrapPrivateKey,
  type PackageItemKey,
  type PersonKeyPair,
} from '@memoriae/crypto';
import { api, type DatiRilascio, type VoceCondivisa } from './api';
import { contestoFile, documentiDi, type ContenutoVoce, type FileVoce } from './vault';

/**
 * Apertura dopo un rilascio. Tutto avviene qui, nel browser:
 * la metà MEMORIAE arriva dal server, la metà del fiduciario si apre con la sua chiave privata,
 * e solo l'unione delle due apre i pacchetti.
 */

export interface VoceAperta {
  id: string;
  contenuto: ContenutoVoce;
  /** Documenti presenti davvero sul server (con nome e tipo dal contenuto cifrato). */
  documenti: FileVoce[];
  itemKey: Uint8Array;
}

export interface EsitoApertura {
  proprietario: string;
  ambito: DatiRilascio['ambito'];
  accessoFinoAl: string | null;
  perMe: VoceAperta[];
  /** Pacchetti «solo rilascio»: chi non ha un account riceve queste voci da me. */
  daConsegnare: { nome: string; voci: VoceAperta[] }[];
  /** Pacchetti partiti verso chi ha un account (li apre solo lui). */
  consegnati: string[];
}

const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** La mia coppia di chiavi personale, custodita (cifrata) nella mia cassaforte. */
export async function mieChiavi(vaultKey: Uint8Array): Promise<PersonKeyPair> {
  const mia = await api.cassaforte();
  return { publicKey: await decodePublicKey(mia.chiavePubblica), privateKey: await unwrapPrivateKey(mia.chiavePrivataCifrata, vaultKey, 'owner') };
}

async function apriVoci(voci: VoceCondivisa[], chiavi: PackageItemKey[]): Promise<VoceAperta[]> {
  const out: VoceAperta[] = [];
  for (const k of chiavi) {
    const v = voci.find((x) => x.id === k.itemId);
    if (!v) continue; // voce cancellata dopo l'ultima preparazione
    const plain = await decryptItem(k.itemKey, { itemId: v.id, wrappedItemKey: v.contenuto, content: v.contenuto });
    const contenuto = JSON.parse(fromUtf8(plain)) as ContenutoVoce;
    const presenti = new Set(v.file.map((f) => f.id));
    out.push({ id: v.id, contenuto, documenti: documentiDi(v.id, contenuto).filter((f) => presenti.has(f.id)), itemKey: k.itemKey });
  }
  return out;
}

export async function apriCaso(casoId: string, vaultKey: Uint8Array): Promise<EsitoApertura> {
  const [d, chiavi, { voci }] = await Promise.all([api.datiRilascio(casoId), mieChiavi(vaultKey), api.vociCaso(casoId)]);
  const releaseKey = await deriveReleaseKeyAtActivation({
    vaultId: d.vaultId,
    scope: d.ambito,
    memoriaeHalf: fromB64(d.metaMemoriae),
    sealedFiduciaryHalf: { personId: d.metaFiduciario.personaId, sealed: d.metaFiduciario.sigillata },
    fiduciaryKeyPair: chiavi,
  });
  const esito: EsitoApertura = { proprietario: d.proprietario, ambito: d.ambito, accessoFinoAl: d.accessoFinoAl, perMe: [], daConsegnare: [], consegnati: [] };
  for (const p of d.pacchetti) {
    const pkg = { packageId: `${p.destinatarioId}:${d.ambito}`, scope: d.ambito, recipientId: p.destinatarioId, kind: p.tipo, outer: p.esterno };
    const interno = await openPackageOuter(d.vaultId, pkg, releaseKey);
    if (p.destinatarioId === d.mioPersonaId) {
      esito.perMe.push(...(await apriVoci(voci, await openPackageInner(p.tipo, interno, chiavi))));
    } else if (p.tipo === 'release-only') {
      esito.daConsegnare.push({ nome: p.nome, voci: await apriVoci(voci, await openPackageInner('release-only', interno)) });
    } else if (p.haAccount) {
      if (!p.consegnato) await api.consegna(casoId, p.destinatarioId, interno);
      esito.consegnati.push(p.nome);
    }
  }
  return esito;
}

/** Destinatario: apre un pacchetto consegnato con la propria chiave privata. */
export async function apriRicevuto(id: string, interno: string, vaultKey: Uint8Array): Promise<VoceAperta[]> {
  const [chiavi, { voci }] = await Promise.all([mieChiavi(vaultKey), api.vociRicevute(id)]);
  return apriVoci(voci, await openPackageInner('sealed-to-recipient', interno, chiavi));
}

export async function salvaFileAperto(voce: VoceAperta, f: FileVoce, scarica: () => Promise<Uint8Array>): Promise<void> {
  const bytes = await decryptFile(voce.itemKey, contestoFile(voce.id, f.id), await scarica());
  salvaBytes(bytes, f.nome || 'documento', f.tipo);
}

export function salvaBytes(bytes: Uint8Array, nome: string, tipo = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
