import { split, combine } from 'shamir-secret-sharing';
import { open, seal, type Envelope } from './envelope';
import { openForPerson, sealToPerson, type PersonKeyPair } from './identity';
import { combineHalves, generateKey, wipe } from './keys';
import { concatBytes, getSodium, KEY_BYTES, MemoriaeCryptoError } from './sodium';
import type { Fiduciary } from './release';

// ---------------------------------------------------------------------------
// Codice di recupero stampato
// ---------------------------------------------------------------------------

/** Alfabeto Crockford Base32: niente I, L, O, U per evitare confusioni quando si ricopia a mano. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECKSUM_BYTES = 2;

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string, byteLength: number): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new MemoriaeCryptoError(`Carattere non valido nel codice di recupero: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length < byteLength) throw new MemoriaeCryptoError('Codice di recupero incompleto');
  return new Uint8Array(out.slice(0, byteLength));
}

/** Normalizza ciò che la persona digita: maiuscole, niente trattini o spazi, I/L→1 e O→0. */
function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

async function checksum(key: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_generichash(16, key, null).slice(0, CHECKSUM_BYTES);
}

/**
 * Genera il codice di recupero da stampare alla registrazione.
 * 256 bit casuali più 16 bit di controllo per riconoscere gli errori di battitura,
 * mostrati in gruppi di 5 caratteri.
 */
export async function generateRecoveryCode(): Promise<{ code: string; key: Uint8Array }> {
  const key = await generateKey();
  const body = toBase32(concatBytes(key, await checksum(key)));
  const code = body.match(/.{1,5}/g)!.join('-');
  return { code, key };
}

/** Ricava la chiave dal codice digitato; segnala se il codice contiene un errore. */
export async function recoveryKeyFromCode(code: string): Promise<Uint8Array> {
  const bytes = fromBase32(normalizeCode(code), KEY_BYTES + CHECKSUM_BYTES);
  const key = bytes.slice(0, KEY_BYTES);
  const given = bytes.slice(KEY_BYTES);
  const expected = await checksum(key);
  if (given[0] !== expected[0] || given[1] !== expected[1]) {
    throw new MemoriaeCryptoError('Codice di recupero non valido: controlla di averlo ricopiato bene');
  }
  return key;
}

// ---------------------------------------------------------------------------
// Recupero sociale (opzionale)
// ---------------------------------------------------------------------------

/**
 * Recupero sociale: la chiave della cassaforte si ricostruisce con
 *   almeno `threshold` quote dei fiduciari (Shamir)  +  la metà MEMORIAE di recupero.
 * La metà MEMORIAE viene consegnata solo dopo verifica d'identità e un periodo d'attesa
 * con avvisi all'utente. Così né MEMORIAE né i fiduciari possono farlo da soli.
 */
export interface SocialRecoverySetup {
  threshold: number;
  memoriaeRecoveryHalf: Uint8Array;
  sealedShares: { personId: string; sealed: string }[];
  wrappedVaultKey: Envelope;
}

function socialPurpose(vaultId: string): string {
  return `social-recovery:${vaultId}`;
}

export async function createSocialRecovery(params: {
  vaultId: string;
  vaultKey: Uint8Array;
  fiduciaries: Fiduciary[];
  threshold: number;
}): Promise<SocialRecoverySetup> {
  const { vaultId, vaultKey, fiduciaries, threshold } = params;
  if (threshold < 2) throw new MemoriaeCryptoError('Il recupero sociale richiede almeno 2 fiduciari');
  if (fiduciaries.length < threshold) {
    throw new MemoriaeCryptoError(`Servono almeno ${threshold} fiduciari per una soglia di ${threshold}`);
  }
  const socialSecret = await generateKey();
  const memoriaeRecoveryHalf = await generateKey();
  const wrappingKey = await combineHalves(memoriaeRecoveryHalf, socialSecret, socialPurpose(vaultId));
  const wrappedVaultKey = await seal(wrappingKey, vaultKey, `vault-key:${vaultId}:social-recovery`);
  const shares = await split(socialSecret, fiduciaries.length, threshold);
  const sealedShares = await Promise.all(
    fiduciaries.map(async (f, i) => ({ personId: f.personId, sealed: await sealToPerson(f.publicKey, shares[i]!) })),
  );
  await wipe(socialSecret, wrappingKey, ...shares);
  return { threshold, memoriaeRecoveryHalf, sealedShares, wrappedVaultKey };
}

/** Ogni fiduciario apre la propria quota e la invia (cifrata) all'utente che sta recuperando. */
export async function openRecoveryShare(sealed: string, fiduciaryKeyPair: PersonKeyPair): Promise<Uint8Array> {
  return openForPerson(fiduciaryKeyPair, sealed);
}

export async function recoverVaultKeyWithSocial(params: {
  vaultId: string;
  shares: Uint8Array[];
  threshold: number;
  memoriaeRecoveryHalf: Uint8Array;
  wrappedVaultKey: Envelope;
}): Promise<Uint8Array> {
  if (params.shares.length < params.threshold) {
    throw new MemoriaeCryptoError(`Servono almeno ${params.threshold} quote dei fiduciari`);
  }
  const socialSecret = await combine(params.shares);
  const wrappingKey = await combineHalves(params.memoriaeRecoveryHalf, socialSecret, socialPurpose(params.vaultId));
  try {
    return await open(wrappingKey, params.wrappedVaultKey, `vault-key:${params.vaultId}:social-recovery`);
  } finally {
    await wipe(socialSecret, wrappingKey);
  }
}
