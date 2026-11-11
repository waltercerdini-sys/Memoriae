import _sodium from 'libsodium-wrappers-sumo';

export type Sodium = typeof _sodium;

let instance: Sodium | null = null;

/**
 * Inizializza libsodium una volta sola e restituisce l'istanza pronta.
 * Tutte le funzioni pubbliche del pacchetto la chiamano per prime.
 */
export async function getSodium(): Promise<Sodium> {
  if (instance) return instance;
  await _sodium.ready;
  instance = _sodium;
  return instance;
}

/** Concatena più array di byte. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Lunghezza di tutte le chiavi simmetriche usate da MEMORIAE (256 bit). */
export const KEY_BYTES = 32;

export class MemoriaeCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoriaeCryptoError';
  }
}

export function assertKey(key: Uint8Array, what: string): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new MemoriaeCryptoError(`${what}: attesa una chiave di ${KEY_BYTES} byte`);
  }
}
