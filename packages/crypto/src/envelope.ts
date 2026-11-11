import { assertKey, getSodium, MemoriaeCryptoError, utf8 } from './sodium';

/**
 * Busta cifrata: il formato con cui ogni dato cifrato viene salvato.
 * `ad` (dati associati) lega il contenuto al suo contesto (per esempio l'id della voce):
 * una busta spostata in un altro contesto non si apre.
 */
export interface Envelope {
  v: 1;
  alg: 'xchacha20poly1305-ietf';
  nonce: string; // base64url
  ct: string; // base64url
}

export async function seal(key: Uint8Array, plaintext: Uint8Array, context: string): Promise<Envelope> {
  const sodium = await getSodium();
  assertKey(key, 'seal');
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, utf8(context), null, nonce, key);
  return {
    v: 1,
    alg: 'xchacha20poly1305-ietf',
    nonce: sodium.to_base64(nonce, sodium.base64_variants.URLSAFE_NO_PADDING),
    ct: sodium.to_base64(ct, sodium.base64_variants.URLSAFE_NO_PADDING),
  };
}

export async function open(key: Uint8Array, envelope: Envelope, context: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  assertKey(key, 'open');
  if (envelope.v !== 1 || envelope.alg !== 'xchacha20poly1305-ietf') {
    throw new MemoriaeCryptoError('Formato della busta non supportato');
  }
  const nonce = sodium.from_base64(envelope.nonce, sodium.base64_variants.URLSAFE_NO_PADDING);
  const ct = sodium.from_base64(envelope.ct, sodium.base64_variants.URLSAFE_NO_PADDING);
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, utf8(context), nonce, key);
  } catch {
    // Chiave sbagliata, contesto sbagliato o dati manomessi: stesso errore per tutti.
    throw new MemoriaeCryptoError('Impossibile aprire la busta: chiave errata o dati alterati');
  }
}
