import { open, seal, type Envelope } from './envelope';
import { generateKey } from './keys';

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

/** Modifica il contenuto di una voce mantenendo la stessa chiave (i pacchetti già creati restano validi). */
export async function reencryptItem(itemKey: Uint8Array, item: EncryptedItem, plaintext: Uint8Array): Promise<EncryptedItem> {
  return { ...item, content: await seal(itemKey, plaintext, `item:${item.itemId}`) };
}
