import type { Envelope } from './envelope';
import { getSodium, utf8 } from './sodium';

/**
 * Impronta delle volontà: un hash BLAKE2b-256 calcolato SOLO su dati già cifrati.
 * Può essere ancorata su blockchain (Polygon) per dimostrare che le volontà esistevano
 * in quella forma a quella data, senza rivelare nulla del contenuto.
 *
 * Le voci sono ordinate per id e ogni campo è preceduto dalla sua lunghezza,
 * così la stessa cassaforte produce sempre la stessa impronta.
 */
export async function computeFingerprint(vaultId: string, entries: { id: string; envelope: Envelope }[]): Promise<string> {
  const sodium = await getSodium();
  const state = sodium.crypto_generichash_init(null, 32);
  const feed = (text: string) => {
    const bytes = utf8(text);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length);
    sodium.crypto_generichash_update(state, len);
    sodium.crypto_generichash_update(state, bytes);
  };
  feed('memoriae-fingerprint-v1');
  feed(vaultId);
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of sorted) {
    feed(e.id);
    feed(e.envelope.nonce);
    feed(e.envelope.ct);
  }
  return sodium.to_hex(sodium.crypto_generichash_final(state, 32));
}
