import { open, seal, type Envelope } from './envelope';
import { openForPerson, sealToPerson, type PersonKeyPair } from './identity';
import { combineHalves, generateKey, wipe } from './keys';
import { fromUtf8, getSodium, MemoriaeCryptoError, utf8 } from './sodium';

/**
 * Rilascio a due metà.
 *
 * chiave di rilascio = unione(metà MEMORIAE dello scopo, metà fiduciari)
 *
 * - La metà MEMORIAE (una per scopo) va nel servizio di gestione chiavi e viene consegnata
 *   solo dopo un'attivazione verificata per QUELLO scopo.
 * - La metà fiduciari è la stessa per tutti i fiduciari, cifrata per ciascuno di loro.
 * - Nessuna delle due metà da sola permette di aprire un pacchetto.
 * - Le metà MEMORIAE sono diverse per "emergenza" e "decesso": un'attivazione d'emergenza
 *   non permette di ricavare la chiave del decesso.
 */
export type ReleaseScope = 'decesso' | 'emergenza';
export const RELEASE_SCOPES: readonly ReleaseScope[] = ['decesso', 'emergenza'];

export interface Fiduciary {
  personId: string;
  publicKey: Uint8Array;
}

export interface SealedFiduciaryHalf {
  personId: string;
  sealed: string;
}

export interface ReleaseSetup {
  /** Da inviare al servizio di gestione chiavi, poi cancellare dal browser. */
  memoriaeHalves: Record<ReleaseScope, Uint8Array>;
  /** Da salvare sul server: ogni fiduciario apre solo la propria copia. */
  sealedFiduciaryHalves: SealedFiduciaryHalf[];
  /** Copia per il proprietario, cifrata con la chiave della cassaforte: serve per creare nuovi pacchetti o aggiungere fiduciari. */
  ownerCopy: Envelope;
}

interface OwnerSecrets {
  fiduciaryHalf: Uint8Array;
  releaseKeys: Record<ReleaseScope, Uint8Array>;
}

function releasePurpose(vaultId: string, scope: ReleaseScope): string {
  return `release:${vaultId}:${scope}`;
}

export async function createReleaseSetup(vaultId: string, vaultKey: Uint8Array, fiduciaries: Fiduciary[]): Promise<ReleaseSetup> {
  if (fiduciaries.length === 0) {
    throw new MemoriaeCryptoError('Serve almeno un fiduciario');
  }
  const fiduciaryHalf = await generateKey();
  const memoriaeHalves = { decesso: await generateKey(), emergenza: await generateKey() };
  const releaseKeys = {
    decesso: await combineHalves(memoriaeHalves.decesso, fiduciaryHalf, releasePurpose(vaultId, 'decesso')),
    emergenza: await combineHalves(memoriaeHalves.emergenza, fiduciaryHalf, releasePurpose(vaultId, 'emergenza')),
  };
  const sealedFiduciaryHalves = await Promise.all(
    fiduciaries.map(async (f) => ({ personId: f.personId, sealed: await sealToPerson(f.publicKey, fiduciaryHalf) })),
  );
  const ownerCopy = await sealOwnerSecrets(vaultId, vaultKey, { fiduciaryHalf, releaseKeys });
  await wipe(fiduciaryHalf, releaseKeys.decesso, releaseKeys.emergenza);
  return { memoriaeHalves, sealedFiduciaryHalves, ownerCopy };
}

async function sealOwnerSecrets(vaultId: string, vaultKey: Uint8Array, s: OwnerSecrets): Promise<Envelope> {
  const sodium = await getSodium();
  const b64 = (k: Uint8Array) => sodium.to_base64(k, sodium.base64_variants.URLSAFE_NO_PADDING);
  const json = JSON.stringify({ f: b64(s.fiduciaryHalf), d: b64(s.releaseKeys.decesso), e: b64(s.releaseKeys.emergenza) });
  return seal(vaultKey, utf8(json), `release-owner:${vaultId}`);
}

async function openOwnerSecrets(vaultId: string, vaultKey: Uint8Array, ownerCopy: Envelope): Promise<OwnerSecrets> {
  const sodium = await getSodium();
  const raw = JSON.parse(fromUtf8(await open(vaultKey, ownerCopy, `release-owner:${vaultId}`))) as { f: string; d: string; e: string };
  const dec = (s: string) => sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
  return { fiduciaryHalf: dec(raw.f), releaseKeys: { decesso: dec(raw.d), emergenza: dec(raw.e) } };
}

/** Il proprietario recupera la chiave di rilascio di uno scopo per creare o aggiornare pacchetti. */
export async function ownerReleaseKey(vaultId: string, vaultKey: Uint8Array, ownerCopy: Envelope, scope: ReleaseScope): Promise<Uint8Array> {
  const s = await openOwnerSecrets(vaultId, vaultKey, ownerCopy);
  const other: ReleaseScope = scope === 'decesso' ? 'emergenza' : 'decesso';
  await wipe(s.fiduciaryHalf, s.releaseKeys[other]);
  return s.releaseKeys[scope];
}

/** Aggiunge un fiduciario: riceve la stessa metà degli altri, cifrata per lui. */
export async function addFiduciary(vaultId: string, vaultKey: Uint8Array, ownerCopy: Envelope, fiduciary: Fiduciary): Promise<SealedFiduciaryHalf> {
  const s = await openOwnerSecrets(vaultId, vaultKey, ownerCopy);
  const sealed = await sealToPerson(fiduciary.publicKey, s.fiduciaryHalf);
  await wipe(s.fiduciaryHalf, s.releaseKeys.decesso, s.releaseKeys.emergenza);
  return { personId: fiduciary.personId, sealed };
}

/**
 * All'attivazione: il fiduciario apre la propria metà e la unisce alla metà MEMORIAE
 * consegnata dal servizio di gestione chiavi per quello scopo.
 */
export async function deriveReleaseKeyAtActivation(params: {
  vaultId: string;
  scope: ReleaseScope;
  memoriaeHalf: Uint8Array;
  sealedFiduciaryHalf: SealedFiduciaryHalf;
  fiduciaryKeyPair: PersonKeyPair;
}): Promise<Uint8Array> {
  const fiduciaryHalf = await openForPerson(params.fiduciaryKeyPair, params.sealedFiduciaryHalf.sealed);
  const key = await combineHalves(params.memoriaeHalf, fiduciaryHalf, releasePurpose(params.vaultId, params.scope));
  await wipe(fiduciaryHalf);
  return key;
}

// ---------------------------------------------------------------------------
// Pacchetti destinatario
// ---------------------------------------------------------------------------

export interface PackageItemKey {
  itemId: string;
  itemKey: Uint8Array;
}

/**
 * Un pacchetto destinatario ha due strati:
 * - esterno: si apre con la chiave di rilascio (quindi solo dopo l'attivazione);
 * - interno: cifrato con la chiave pubblica del destinatario, che è l'unico a poterlo aprire.
 *
 * Se il destinatario non ha ancora un account (per esempio un figlio minorenne), si può creare
 * un pacchetto "solo rilascio": dopo l'attivazione lo apre il fiduciario e lo consegna.
 * La scelta va fatta consapevolmente dall'utente.
 */
export type PackageKind = 'sealed-to-recipient' | 'release-only';

export interface RecipientPackage {
  packageId: string;
  scope: ReleaseScope;
  recipientId: string;
  kind: PackageKind;
  outer: Envelope;
}

function packageContext(vaultId: string, p: { packageId: string; scope: ReleaseScope; recipientId: string; kind: PackageKind }): string {
  return `package:${vaultId}:${p.packageId}:${p.scope}:${p.recipientId}:${p.kind}`;
}

async function encodeItemKeys(items: PackageItemKey[]): Promise<Uint8Array> {
  const sodium = await getSodium();
  const list = items.map((i) => ({ id: i.itemId, k: sodium.to_base64(i.itemKey, sodium.base64_variants.URLSAFE_NO_PADDING) }));
  return utf8(JSON.stringify(list));
}

async function decodeItemKeys(bytes: Uint8Array): Promise<PackageItemKey[]> {
  const sodium = await getSodium();
  const list = JSON.parse(fromUtf8(bytes)) as { id: string; k: string }[];
  return list.map((e) => ({ itemId: e.id, itemKey: sodium.from_base64(e.k, sodium.base64_variants.URLSAFE_NO_PADDING) }));
}

export async function buildRecipientPackage(params: {
  vaultId: string;
  packageId: string;
  scope: ReleaseScope;
  releaseKey: Uint8Array;
  recipientId: string;
  /** Assente = pacchetto "solo rilascio". */
  recipientPublicKey?: Uint8Array;
  items: PackageItemKey[];
}): Promise<RecipientPackage> {
  const sodium = await getSodium();
  const kind: PackageKind = params.recipientPublicKey ? 'sealed-to-recipient' : 'release-only';
  const payload = await encodeItemKeys(params.items);
  const inner = params.recipientPublicKey
    ? await sealToPerson(params.recipientPublicKey, payload)
    : sodium.to_base64(payload, sodium.base64_variants.URLSAFE_NO_PADDING);
  const meta = { packageId: params.packageId, scope: params.scope, recipientId: params.recipientId, kind };
  const outer = await seal(params.releaseKey, utf8(inner), packageContext(params.vaultId, meta));
  return { ...meta, outer };
}

/** Dopo l'attivazione: toglie lo strato esterno. Il risultato si consegna al destinatario. */
export async function openPackageOuter(vaultId: string, pkg: RecipientPackage, releaseKey: Uint8Array): Promise<string> {
  return fromUtf8(await open(releaseKey, pkg.outer, packageContext(vaultId, pkg)));
}

/** Il destinatario apre lo strato interno e ottiene le chiavi delle sue voci. */
export async function openPackageInner(
  kind: PackageKind,
  inner: string,
  recipientKeyPair?: PersonKeyPair,
): Promise<PackageItemKey[]> {
  const sodium = await getSodium();
  if (kind === 'sealed-to-recipient') {
    if (!recipientKeyPair) throw new MemoriaeCryptoError('Serve la chiave del destinatario');
    return decodeItemKeys(await openForPerson(recipientKeyPair, inner));
  }
  return decodeItemKeys(sodium.from_base64(inner, sodium.base64_variants.URLSAFE_NO_PADDING));
}
