import { describe, expect, it } from 'vitest';
import {
  computeFingerprint,
  createSocialRecovery,
  createVaultKey,
  encryptItem,
  generateKey,
  generatePersonKeyPair,
  generateRecoveryCode,
  openRecoveryShare,
  recoverVaultKeyWithSocial,
  recoveryKeyFromCode,
  recoveryVerifier,
  unwrapVaultKey,
  utf8,
  wrapVaultKey,
  MemoriaeCryptoError,
} from '../src';

describe('codice di recupero', () => {
  it('genera un codice leggibile e ne ricava la stessa chiave', async () => {
    const { code, key } = await generateRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-)+[0-9A-HJKMNP-TV-Z]{1,5}$/);
    expect(await recoveryKeyFromCode(code)).toEqual(key);
  });

  it('accetta il codice scritto in minuscolo, senza trattini e con O al posto di 0', async () => {
    const { code, key } = await generateRecoveryCode();
    const sloppy = code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(await recoveryKeyFromCode(sloppy)).toEqual(key);
  });

  it('riconosce un errore di battitura', async () => {
    const { code } = await generateRecoveryCode();
    const i = code.search(/[0-9A-Z]/);
    const wrongChar = code[i] === 'A' ? 'B' : 'A';
    const typo = code.slice(0, i) + wrongChar + code.slice(i + 1);
    await expect(recoveryKeyFromCode(typo)).rejects.toThrow(MemoriaeCryptoError);
  });

  it('apre la cassaforte con il codice di recupero', async () => {
    const vaultKey = await createVaultKey();
    const { code, key } = await generateRecoveryCode();
    const wrapped = await wrapVaultKey(vaultKey, key, 'v1', 'recovery-code');
    expect(await unwrapVaultKey(wrapped, await recoveryKeyFromCode(code), 'v1', 'recovery-code')).toEqual(vaultKey);
  });
});

describe('verificatore del codice di recupero', () => {
  it('è stabile per lo stesso codice, diverso dalla chiave e diverso per codici diversi', async () => {
    const a = await generateRecoveryCode();
    const b = await generateRecoveryCode();
    const va = await recoveryVerifier(a.key);
    expect(await recoveryVerifier(await recoveryKeyFromCode(a.code))).toBe(va);
    expect(va).not.toBe(await recoveryVerifier(b.key));
    expect(va).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Il verificatore non apre la cassaforte.
    const vaultKey = await createVaultKey();
    const wrapped = await wrapVaultKey(vaultKey, a.key, 'v1', 'recovery-code');
    const fromVerifier = new Uint8Array(Buffer.from(va, 'base64url'));
    await expect(unwrapVaultKey(wrapped, fromVerifier, 'v1', 'recovery-code')).rejects.toThrow(MemoriaeCryptoError);
  });
});

describe('recupero sociale', () => {
  async function scenario() {
    const vaultKey = await createVaultKey();
    const people = await Promise.all([generatePersonKeyPair(), generatePersonKeyPair(), generatePersonKeyPair()]);
    const setup = await createSocialRecovery({
      vaultId: 'v1',
      vaultKey,
      threshold: 2,
      fiduciaries: people.map((p, i) => ({ personId: `f${i}`, publicKey: p.publicKey })),
    });
    const shareOf = (i: number) => openRecoveryShare(setup.sealedShares[i]!.sealed, people[i]!);
    return { vaultKey, setup, shareOf };
  }

  it('2 fiduciari su 3 + metà MEMORIAE recuperano la cassaforte', async () => {
    const { vaultKey, setup, shareOf } = await scenario();
    const recovered = await recoverVaultKeyWithSocial({
      vaultId: 'v1',
      shares: [await shareOf(0), await shareOf(2)],
      threshold: 2,
      memoriaeRecoveryHalf: setup.memoriaeRecoveryHalf,
      wrappedVaultKey: setup.wrappedVaultKey,
    });
    expect(recovered).toEqual(vaultKey);
  });

  it('un solo fiduciario non basta', async () => {
    const { setup, shareOf } = await scenario();
    await expect(
      recoverVaultKeyWithSocial({
        vaultId: 'v1',
        shares: [await shareOf(1)],
        threshold: 2,
        memoriaeRecoveryHalf: setup.memoriaeRecoveryHalf,
        wrappedVaultKey: setup.wrappedVaultKey,
      }),
    ).rejects.toThrow(MemoriaeCryptoError);
  });

  it('i fiduciari senza la metà MEMORIAE non bastano', async () => {
    const { setup, shareOf } = await scenario();
    await expect(
      recoverVaultKeyWithSocial({
        vaultId: 'v1',
        shares: [await shareOf(0), await shareOf(1)],
        threshold: 2,
        memoriaeRecoveryHalf: await generateKey(),
        wrappedVaultKey: setup.wrappedVaultKey,
      }),
    ).rejects.toThrow(MemoriaeCryptoError);
  });

  it('rifiuta soglie troppo basse o troppo alte', async () => {
    const vaultKey = await createVaultKey();
    const p = await generatePersonKeyPair();
    const one = [{ personId: 'f0', publicKey: p.publicKey }];
    await expect(createSocialRecovery({ vaultId: 'v1', vaultKey, fiduciaries: one, threshold: 1 })).rejects.toThrow(
      MemoriaeCryptoError,
    );
    await expect(createSocialRecovery({ vaultId: 'v1', vaultKey, fiduciaries: one, threshold: 2 })).rejects.toThrow(
      MemoriaeCryptoError,
    );
  });
});

describe('impronta delle volontà', () => {
  it('è stabile, indipendente dall\'ordine e cambia se cambia un contenuto', async () => {
    const vaultKey = await createVaultKey();
    const a = (await encryptItem(vaultKey, 'a', utf8('uno'))).item;
    const b = (await encryptItem(vaultKey, 'b', utf8('due'))).item;
    const entries = [
      { id: 'a', envelope: a.content },
      { id: 'b', envelope: b.content },
    ];
    const f1 = await computeFingerprint('v1', entries);
    const f2 = await computeFingerprint('v1', [...entries].reverse());
    expect(f1).toBe(f2);
    expect(f1).toMatch(/^[0-9a-f]{64}$/);

    const b2 = (await encryptItem(vaultKey, 'b', utf8('due bis'))).item;
    const f3 = await computeFingerprint('v1', [entries[0]!, { id: 'b', envelope: b2.content }]);
    expect(f3).not.toBe(f1);
  });
});
