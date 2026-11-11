import { open, seal, type Envelope } from './envelope';
import { getSodium, MemoriaeCryptoError } from './sodium';

/** Coppia di chiavi X25519 di una persona (utente, fiduciario o destinatario). */
export interface PersonKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function generatePersonKeyPair(): Promise<PersonKeyPair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/** Cifra dati per una persona: solo chi ha la sua chiave privata potrà aprirli. */
export async function sealToPerson(publicKey: Uint8Array, data: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new MemoriaeCryptoError('Chiave pubblica non valida');
  }
  const sealed = sodium.crypto_box_seal(data, publicKey);
  return sodium.to_base64(sealed, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export async function openForPerson(keyPair: PersonKeyPair, sealed: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  try {
    const bytes = sodium.from_base64(sealed, sodium.base64_variants.URLSAFE_NO_PADDING);
    return sodium.crypto_box_seal_open(bytes, keyPair.publicKey, keyPair.privateKey);
  } catch {
    throw new MemoriaeCryptoError('Impossibile aprire: non destinato a questa persona o dati alterati');
  }
}

/** Protegge la chiave privata di una persona con la sua chiave d'accesso (passkey o password). */
export async function wrapPrivateKey(privateKey: Uint8Array, accessKey: Uint8Array, personId: string): Promise<Envelope> {
  return seal(accessKey, privateKey, `person-private-key:${personId}`);
}

export async function unwrapPrivateKey(envelope: Envelope, accessKey: Uint8Array, personId: string): Promise<Uint8Array> {
  return open(accessKey, envelope, `person-private-key:${personId}`);
}

export async function encodePublicKey(publicKey: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  return sodium.to_base64(publicKey, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export async function decodePublicKey(encoded: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.from_base64(encoded, sodium.base64_variants.URLSAFE_NO_PADDING);
}
