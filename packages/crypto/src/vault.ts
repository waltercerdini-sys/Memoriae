import { open, seal, type Envelope } from './envelope';
import { generateKey } from './keys';
import { assertKey, concatBytes, getSodium, MemoriaeCryptoError, utf8 } from './sodium';

/**
 * La cassaforte di un utente.
 * La chiave della cassaforte non lascia mai il browser in chiaro: sul server ci sono solo
 * le sue copie cifrate con i diversi metodi d'accesso.
 */
export type AccessMethod = 'passkey' | 'password' | 'recovery-code' | 'social-recovery';

export async function createVaultKey(): Promise<Uint8Array> {
  return generateKey();
}

export async function wrapVaultKey(
  vaultKey: Uint8Array,
  wrappingKey: Uint8Array,
  vaultId: string,
  method: AccessMethod,
): Promise<Envelope> {
  return seal(wrappingKey, vaultKey, `vault-key:${vaultId}:${method}`);
}

export async function unwrapVaultKey(
  envelope: Envelope,
  wrappingKey: Uint8Array,
  vaultId: string,
  method: AccessMethod,
): Promise<Uint8Array> {
  return open(wrappingKey, envelope, `vault-key:${vaultId}:${method}`);
}

/** Una voce cifrata: il contenuto con la sua chiave, la chiave con la chiave della cassaforte. */
export interface EncryptedItem {
  itemId: string;
  wrappedItemKey: Envelope;
  content: Envelope;
}

export async function encryptItem(
  vaultKey: Uint8Array,
  itemId: string,
  plaintext: Uint8Array,
): Promise<{ item: EncryptedItem; itemKey: Uint8Array }> {
  const itemKey = await generateKey();
  const content = await seal(itemKey, plaintext, `item:${itemId}`);
  const wrappedItemKey = await seal(vaultKey, itemKey, `item-key:${itemId}`);
  return { item: { itemId, wrappedItemKey, content }, itemKey };
}

export async function unwrapItemKey(vaultKey: Uint8Array, item: EncryptedItem): Promise<Uint8Array> {
  return open(vaultKey, item.wrappedItemKey, `item-key:${item.itemId}`);
}

export async function decryptItem(itemKey: Uint8Array, item: EncryptedItem): Promise<Uint8Array> {
  return open(itemKey, item.content, `item:${item.itemId}`);
}

// ---------------------------------------------------------------------------
// File allegati a una voce (formato binario, per non gonfiare i file del 33% con base64)
// ---------------------------------------------------------------------------

/** Intestazione dei file cifrati: "MEM1". */
const FILE_MAGIC = new Uint8Array([0x4d, 0x45, 0x4d, 0x31]);
/** Dimensione massima di un file nell'MVP. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Cifra un file con la chiave della voce: intestazione + nonce + testo cifrato. */
export async function encryptFile(itemKey: Uint8Array, itemId: string, bytes: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  assertKey(itemKey, 'encryptFile');
  if (bytes.length > MAX_FILE_BYTES) throw new MemoriaeCryptoError('File troppo grande (massimo 25 MB)');
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, utf8(`file:${itemId}`), null, nonce, itemKey);
  return concatBytes(FILE_MAGIC, nonce, ct);
}

export async function decryptFile(itemKey: Uint8Array, itemId: string, blob: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  assertKey(itemKey, 'decryptFile');
  const n = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
  if (blob.length < FILE_MAGIC.length + n || !FILE_MAGIC.every((b, i) => blob[i] === b)) {
    throw new MemoriaeCryptoError('File cifrato non riconosciuto');
  }
  const nonce = blob.slice(FILE_MAGIC.length, FILE_MAGIC.length + n);
  const ct = blob.slice(FILE_MAGIC.length + n);
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, utf8(`file:${itemId}`), nonce, itemKey);
  } catch {
    throw new MemoriaeCryptoError('Impossibile aprire il file: chiave errata o dati alterati');
  }
}

/** Modifica il contenuto di una voce mantenendo la stessa chiave (i pacchetti già creati restano validi). */
export async function reencryptItem(itemKey: Uint8Array, item: EncryptedItem, plaintext: Uint8Array): Promise<EncryptedItem> {
  return { ...item, content: await seal(itemKey, plaintext, `item:${item.itemId}`) };
}
