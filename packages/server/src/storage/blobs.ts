import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Archivio dei file cifrati. Riceve solo byte già cifrati nel browser.
 * In sviluppo: cartella locale. In produzione: object storage S3 di Infomaniak (da aggiungere).
 */
export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

function checkKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error(`Chiave d'archivio non valida: ${key}`);
}

export function blobKey(vaultId: string, itemId: string): string {
  return `${vaultId}/${itemId}`;
}

export class MemoryBlobStore implements BlobStore {
  private readonly data = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    checkKey(key);
    this.data.set(key, new Uint8Array(bytes));
  }
  async get(key: string) {
    checkKey(key);
    return this.data.get(key) ?? null;
  }
  async delete(key: string) {
    checkKey(key);
    this.data.delete(key);
  }
}

export class LocalDiskBlobStore implements BlobStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    checkKey(key);
    return join(this.root, `${key}.bin`);
  }
  async put(key: string, bytes: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}
