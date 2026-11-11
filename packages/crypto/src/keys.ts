import { assertKey, getSodium, KEY_BYTES, MemoriaeCryptoError, utf8 } from './sodium';

/** Genera una chiave simmetrica casuale da 256 bit. */
export async function generateKey(): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.randombytes_buf(KEY_BYTES);
}

/** Parametri Argon2id salvati accanto alla cassaforte per poter ricalcolare la chiave. */
export interface PasswordKdfParams {
  alg: 'argon2id13';
  salt: string; // base64url
  opslimit: number;
  memlimit: number;
}

/**
 * Parametri predefiniti: 3 passaggi, 64 MiB.
 * Sopra il minimo consigliato da OWASP (19 MiB, 2 passaggi) e ancora praticabile su un telefono.
 */
export const DEFAULT_ARGON2_OPSLIMIT = 3;
export const DEFAULT_ARGON2_MEMLIMIT = 64 * 1024 * 1024;

/** Deriva la chiave d'accesso da una password (accesso di riserva quando non c'è la passkey). */
export async function deriveKeyFromPassword(
  password: string,
  params?: PasswordKdfParams,
): Promise<{ key: Uint8Array; params: PasswordKdfParams }> {
  const sodium = await getSodium();
  if (password.length < 12) {
    throw new MemoriaeCryptoError('La password deve avere almeno 12 caratteri');
  }
  const p: PasswordKdfParams = params ?? {
    alg: 'argon2id13',
    salt: sodium.to_base64(
      sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES),
      sodium.base64_variants.URLSAFE_NO_PADDING,
    ),
    opslimit: DEFAULT_ARGON2_OPSLIMIT,
    memlimit: DEFAULT_ARGON2_MEMLIMIT,
  };
  const salt = sodium.from_base64(p.salt, sodium.base64_variants.URLSAFE_NO_PADDING);
  const key = sodium.crypto_pwhash(
    KEY_BYTES,
    password.normalize('NFKC'),
    salt,
    p.opslimit,
    p.memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  return { key, params: p };
}

/**
 * Deriva la chiave d'accesso dal segreto restituito dalla passkey (estensione WebAuthn PRF).
 * Il segreto della passkey non viene mai usato direttamente come chiave.
 */
export async function deriveKeyFromPasskeySecret(prfOutput: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  assertKey(prfOutput, 'deriveKeyFromPasskeySecret');
  // Il contesto di crypto_kdf deve essere di esattamente 8 caratteri.
  return sodium.crypto_kdf_derive_from_key(KEY_BYTES, 1, 'memacces', prfOutput);
}

/**
 * Unisce due segreti indipendenti in una chiave sola, con separazione per scopo.
 * Senza ENTRAMBI i segreti la chiave non si ottiene.
 */
export async function combineHalves(first: Uint8Array, second: Uint8Array, purpose: string): Promise<Uint8Array> {
  const sodium = await getSodium();
  assertKey(first, 'combineHalves (prima metà)');
  assertKey(second, 'combineHalves (seconda metà)');
  return sodium.crypto_generichash(KEY_BYTES, new Uint8Array([...utf8(`memoriae:${purpose}:`), ...second]), first);
}

/** Cancella una chiave dalla memoria appena non serve più. */
export async function wipe(...keys: Uint8Array[]): Promise<void> {
  const sodium = await getSodium();
  for (const k of keys) sodium.memzero(k);
}
