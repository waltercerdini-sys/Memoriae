import { beforeAll, describe, expect, it } from 'vitest';
import {
  addFiduciary,
  buildRecipientPackage,
  combineHalves,
  createReleaseSetup,
  createVaultKey,
  decryptItem,
  deriveReleaseKeyAtActivation,
  encryptItem,
  fromUtf8,
  generateKey,
  generatePersonKeyPair,
  openPackageInner,
  openPackageOuter,
  ownerReleaseKey,
  utf8,
  MemoriaeCryptoError,
  type EncryptedItem,
  type PersonKeyPair,
  type RecipientPackage,
  type ReleaseSetup,
} from '../src';

/**
 * Scenario: Rosa (utente) nomina due fiduciari, Anna e Bruno.
 * - Le foto vanno al figlio Marco (ha un account).
 * - Una lettera va alla nipote Giulia, minorenne e senza account: pacchetto "solo rilascio".
 * - Le istruzioni per la banca sono marcate "emergenza" e vanno ad Anna.
 */
const VAULT = 'cassaforte-rosa';

let vaultKey: Uint8Array;
let anna: PersonKeyPair;
let bruno: PersonKeyPair;
let marco: PersonKeyPair;
let setup: ReleaseSetup;
let foto: EncryptedItem;
let lettera: EncryptedItem;
let banca: EncryptedItem;
let pkgMarco: RecipientPackage;
let pkgGiulia: RecipientPackage;
let pkgAnnaEmergenza: RecipientPackage;

beforeAll(async () => {
  vaultKey = await createVaultKey();
  [anna, bruno, marco] = await Promise.all([generatePersonKeyPair(), generatePersonKeyPair(), generatePersonKeyPair()]);

  const f = await encryptItem(vaultKey, 'foto', utf8('Cartella foto famiglia 1990-2025'));
  const l = await encryptItem(vaultKey, 'lettera', utf8('Cara Giulia, ...'));
  const b = await encryptItem(vaultKey, 'banca', utf8('Banca: chiamare il consulente, procura in cassaforte'));
  foto = f.item;
  lettera = l.item;
  banca = b.item;

  setup = await createReleaseSetup(VAULT, vaultKey, [
    { personId: 'anna', publicKey: anna.publicKey },
    { personId: 'bruno', publicKey: bruno.publicKey },
  ]);

  const keyDecesso = await ownerReleaseKey(VAULT, vaultKey, setup.ownerCopy, 'decesso');
  const keyEmergenza = await ownerReleaseKey(VAULT, vaultKey, setup.ownerCopy, 'emergenza');

  pkgMarco = await buildRecipientPackage({
    vaultId: VAULT,
    packageId: 'p-marco',
    scope: 'decesso',
    releaseKey: keyDecesso,
    recipientId: 'marco',
    recipientPublicKey: marco.publicKey,
    items: [{ itemId: 'foto', itemKey: f.itemKey }],
  });
  pkgGiulia = await buildRecipientPackage({
    vaultId: VAULT,
    packageId: 'p-giulia',
    scope: 'decesso',
    releaseKey: keyDecesso,
    recipientId: 'giulia',
    items: [{ itemId: 'lettera', itemKey: l.itemKey }],
  });
  pkgAnnaEmergenza = await buildRecipientPackage({
    vaultId: VAULT,
    packageId: 'p-anna-em',
    scope: 'emergenza',
    releaseKey: keyEmergenza,
    recipientId: 'anna',
    recipientPublicKey: anna.publicKey,
    items: [{ itemId: 'banca', itemKey: b.itemKey }],
  });
});

function halfOf(personId: string) {
  const h = setup.sealedFiduciaryHalves.find((x) => x.personId === personId);
  if (!h) throw new Error(`metà di ${personId} mancante`);
  return h;
}

describe('rilascio dopo un decesso', () => {
  it('Bruno + metà MEMORIAE aprono lo strato esterno; solo Marco apre le sue foto', async () => {
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: VAULT,
      scope: 'decesso',
      memoriaeHalf: setup.memoriaeHalves.decesso,
      sealedFiduciaryHalf: halfOf('bruno'),
      fiduciaryKeyPair: bruno,
    });
    const inner = await openPackageOuter(VAULT, pkgMarco, releaseKey);

    // Bruno non può leggere lo strato interno destinato a Marco.
    await expect(openPackageInner(pkgMarco.kind, inner, bruno)).rejects.toThrow(MemoriaeCryptoError);

    const keys = await openPackageInner(pkgMarco.kind, inner, marco);
    expect(keys.map((k) => k.itemId)).toEqual(['foto']);
    expect(fromUtf8(await decryptItem(keys[0]!.itemKey, foto))).toBe('Cartella foto famiglia 1990-2025');

    // La chiave delle foto non apre la lettera.
    await expect(decryptItem(keys[0]!.itemKey, lettera)).rejects.toThrow(MemoriaeCryptoError);
  });

  it('il pacchetto "solo rilascio" per Giulia lo apre il fiduciario, per consegnarlo', async () => {
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: VAULT,
      scope: 'decesso',
      memoriaeHalf: setup.memoriaeHalves.decesso,
      sealedFiduciaryHalf: halfOf('anna'),
      fiduciaryKeyPair: anna,
    });
    const inner = await openPackageOuter(VAULT, pkgGiulia, releaseKey);
    const keys = await openPackageInner(pkgGiulia.kind, inner);
    expect(fromUtf8(await decryptItem(keys[0]!.itemKey, lettera))).toBe('Cara Giulia, ...');
  });

  it('la chiave del decesso non apre i pacchetti d\'emergenza', async () => {
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: VAULT,
      scope: 'decesso',
      memoriaeHalf: setup.memoriaeHalves.decesso,
      sealedFiduciaryHalf: halfOf('anna'),
      fiduciaryKeyPair: anna,
    });
    await expect(openPackageOuter(VAULT, pkgAnnaEmergenza, releaseKey)).rejects.toThrow(MemoriaeCryptoError);
  });
});

describe('rilascio in emergenza', () => {
  it('apre solo le voci d\'emergenza, non quelle del decesso', async () => {
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: VAULT,
      scope: 'emergenza',
      memoriaeHalf: setup.memoriaeHalves.emergenza,
      sealedFiduciaryHalf: halfOf('anna'),
      fiduciaryKeyPair: anna,
    });
    const inner = await openPackageOuter(VAULT, pkgAnnaEmergenza, releaseKey);
    const keys = await openPackageInner(pkgAnnaEmergenza.kind, inner, anna);
    expect(fromUtf8(await decryptItem(keys[0]!.itemKey, banca))).toContain('Banca');

    await expect(openPackageOuter(VAULT, pkgMarco, releaseKey)).rejects.toThrow(MemoriaeCryptoError);
    await expect(openPackageOuter(VAULT, pkgGiulia, releaseKey)).rejects.toThrow(MemoriaeCryptoError);
  });
});

describe('nessuno da solo', () => {
  it('MEMORIAE da sola non apre nulla (senza la metà dei fiduciari)', async () => {
    const guess = await combineHalves(setup.memoriaeHalves.decesso, await generateKey(), `release:${VAULT}:decesso`);
    await expect(openPackageOuter(VAULT, pkgGiulia, guess)).rejects.toThrow(MemoriaeCryptoError);
  });

  it('un fiduciario da solo non apre nulla (senza la metà MEMORIAE)', async () => {
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: VAULT,
      scope: 'decesso',
      memoriaeHalf: await generateKey(),
      sealedFiduciaryHalf: halfOf('anna'),
      fiduciaryKeyPair: anna,
    });
    await expect(openPackageOuter(VAULT, pkgGiulia, releaseKey)).rejects.toThrow(MemoriaeCryptoError);
  });

  it('un fiduciario non può usare la metà cifrata per un altro', async () => {
    await expect(
      deriveReleaseKeyAtActivation({
        vaultId: VAULT,
        scope: 'decesso',
        memoriaeHalf: setup.memoriaeHalves.decesso,
        sealedFiduciaryHalf: halfOf('anna'),
        fiduciaryKeyPair: bruno,
      }),
    ).rejects.toThrow(MemoriaeCryptoError);
  });

  it('un pacchetto con destinatario cambiato non si apre', async () => {
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: VAULT,
      scope: 'decesso',
      memoriaeHalf: setup.memoriaeHalves.decesso,
      sealedFiduciaryHalf: halfOf('anna'),
      fiduciaryKeyPair: anna,
    });
    await expect(openPackageOuter(VAULT, { ...pkgGiulia, recipientId: 'anna' }, releaseKey)).rejects.toThrow(
      MemoriaeCryptoError,
    );
  });

  it('la metà di un\'altra cassaforte non funziona', async () => {
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: 'altra-cassaforte',
      scope: 'decesso',
      memoriaeHalf: setup.memoriaeHalves.decesso,
      sealedFiduciaryHalf: halfOf('anna'),
      fiduciaryKeyPair: anna,
    });
    await expect(openPackageOuter(VAULT, pkgGiulia, releaseKey)).rejects.toThrow(MemoriaeCryptoError);
  });
});

describe('gestione dei fiduciari', () => {
  it('un fiduciario aggiunto dopo ottiene la stessa chiave di rilascio', async () => {
    const carla = await generatePersonKeyPair();
    const sealed = await addFiduciary(VAULT, vaultKey, setup.ownerCopy, { personId: 'carla', publicKey: carla.publicKey });
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: VAULT,
      scope: 'decesso',
      memoriaeHalf: setup.memoriaeHalves.decesso,
      sealedFiduciaryHalf: sealed,
      fiduciaryKeyPair: carla,
    });
    const inner = await openPackageOuter(VAULT, pkgGiulia, releaseKey);
    expect((await openPackageInner(pkgGiulia.kind, inner))[0]!.itemId).toBe('lettera');
  });

  it('serve almeno un fiduciario', async () => {
    await expect(createReleaseSetup(VAULT, vaultKey, [])).rejects.toThrow(MemoriaeCryptoError);
  });
});
