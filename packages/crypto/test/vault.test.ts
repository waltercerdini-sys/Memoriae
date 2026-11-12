import { describe, expect, it } from 'vitest';
import {
  createVaultKey,
  decryptFile,
  decryptItem,
  encryptFile,
  deriveKeyFromPasskeySecret,
  deriveKeyFromPassword,
  encryptItem,
  fromUtf8,
  generateKey,
  generatePersonKeyPair,
  reencryptItem,
  unwrapItemKey,
  unwrapPrivateKey,
  unwrapVaultKey,
  utf8,
  wrapPrivateKey,
  wrapVaultKey,
  MemoriaeCryptoError,
} from '../src';

describe('cassaforte e voci', () => {
  it('cifra e decifra una voce passando dalla chiave della cassaforte', async () => {
    const vaultKey = await createVaultKey();
    const { item } = await encryptItem(vaultKey, 'voce-1', utf8('Conto UBS: istruzioni per gli eredi'));
    const itemKey = await unwrapItemKey(vaultKey, item);
    expect(fromUtf8(await decryptItem(itemKey, item))).toBe('Conto UBS: istruzioni per gli eredi');
  });

  it('non apre una voce con una chiave sbagliata', async () => {
    const vaultKey = await createVaultKey();
    const { item } = await encryptItem(vaultKey, 'voce-1', utf8('segreto'));
    await expect(unwrapItemKey(await createVaultKey(), item)).rejects.toThrow(MemoriaeCryptoError);
  });

  it('rifiuta una voce spostata sotto un altro id (contesto legato)', async () => {
    const vaultKey = await createVaultKey();
    const { item, itemKey } = await encryptItem(vaultKey, 'voce-1', utf8('segreto'));
    await expect(decryptItem(itemKey, { ...item, itemId: 'voce-2' })).rejects.toThrow(MemoriaeCryptoError);
  });

  it('rileva un contenuto manomesso', async () => {
    const vaultKey = await createVaultKey();
    const { item, itemKey } = await encryptItem(vaultKey, 'voce-1', utf8('segreto'));
    const ct = item.content.ct;
    const tampered = { ...item, content: { ...item.content, ct: (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1) } };
    await expect(decryptItem(itemKey, tampered)).rejects.toThrow(MemoriaeCryptoError);
  });

  it('aggiorna una voce mantenendo la stessa chiave', async () => {
    const vaultKey = await createVaultKey();
    const { item, itemKey } = await encryptItem(vaultKey, 'voce-1', utf8('v1'));
    const updated = await reencryptItem(itemKey, item, utf8('v2'));
    expect(fromUtf8(await decryptItem(itemKey, updated))).toBe('v2');
  });
});

describe('file allegati', () => {
  it('cifra e decifra un file legato alla sua voce', async () => {
    const vaultKey = await createVaultKey();
    const { itemKey } = await encryptItem(vaultKey, 'voce-1', utf8('meta'));
    const pdf = new Uint8Array(100_000).map((_, i) => i % 251);
    const blob = await encryptFile(itemKey, 'voce-1', pdf);
    expect(blob.slice(0, 4)).toEqual(new Uint8Array([0x4d, 0x45, 0x4d, 0x31]));
    expect(await decryptFile(itemKey, 'voce-1', blob)).toEqual(pdf);
    await expect(decryptFile(itemKey, 'voce-2', blob)).rejects.toThrow(MemoriaeCryptoError);
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 1;
    await expect(decryptFile(itemKey, 'voce-1', blob)).rejects.toThrow(MemoriaeCryptoError);
  });
});

describe('chiavi d\'accesso', () => {
  it('ricava la stessa chiave dalla stessa password e dagli stessi parametri', async () => {
    const first = await deriveKeyFromPassword('una frase lunga e sicura');
    const again = await deriveKeyFromPassword('una frase lunga e sicura', first.params);
    expect(again.key).toEqual(first.key);
    const other = await deriveKeyFromPassword('una frase lunga e diversa', first.params);
    expect(other.key).not.toEqual(first.key);
  });

  it('rifiuta password troppo corte', async () => {
    await expect(deriveKeyFromPassword('corta')).rejects.toThrow(MemoriaeCryptoError);
  });

  it('apre la cassaforte con passkey o password, ma non con l\'una al posto dell\'altra', async () => {
    const vaultKey = await createVaultKey();
    const passkeyKey = await deriveKeyFromPasskeySecret(await generateKey());
    const { key: passwordKey } = await deriveKeyFromPassword('password di riserva molto lunga');
    const viaPasskey = await wrapVaultKey(vaultKey, passkeyKey, 'v1', 'passkey');
    const viaPassword = await wrapVaultKey(vaultKey, passwordKey, 'v1', 'password');
    expect(await unwrapVaultKey(viaPasskey, passkeyKey, 'v1', 'passkey')).toEqual(vaultKey);
    expect(await unwrapVaultKey(viaPassword, passwordKey, 'v1', 'password')).toEqual(vaultKey);
    await expect(unwrapVaultKey(viaPasskey, passkeyKey, 'v1', 'password')).rejects.toThrow(MemoriaeCryptoError);
    await expect(unwrapVaultKey(viaPasskey, passwordKey, 'v1', 'passkey')).rejects.toThrow(MemoriaeCryptoError);
  });

  it('protegge la chiave privata di una persona con la sua chiave d\'accesso', async () => {
    const kp = await generatePersonKeyPair();
    const accessKey = await generateKey();
    const wrapped = await wrapPrivateKey(kp.privateKey, accessKey, 'persona-1');
    expect(await unwrapPrivateKey(wrapped, accessKey, 'persona-1')).toEqual(kp.privateKey);
    await expect(unwrapPrivateKey(wrapped, accessKey, 'persona-2')).rejects.toThrow(MemoriaeCryptoError);
  });
});
