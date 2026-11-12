import { open, seal, type Envelope } from '@memoriae/crypto';
import { and, eq } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { Database } from '../db/client';
import { custodyKeys } from '../db/schema';

/**
 * Custodia delle metà MEMORIAE delle chiavi di rilascio.
 *
 * Interfaccia pensata per un servizio di gestione chiavi esterno (KMS o modulo hardware):
 * l'applicazione conserva solo il riferimento; la metà esce solo con `reveal`, che verrà
 * chiamato esclusivamente dal flusso di attivazione dopo verifica e attesa.
 */
export type CustodyPurpose = 'decesso' | 'emergenza' | 'recupero-sociale';

export interface KeyCustody {
  store(vaultId: string, purpose: CustodyPurpose, half: Uint8Array): Promise<string>;
  reveal(ref: string): Promise<Uint8Array>;
  destroy(ref: string): Promise<void>;
}

/**
 * Custodia di SVILUPPO: le metà sono cifrate con una chiave principale tenuta fuori dal database.
 * Non adatta alla produzione.
 */
export class DevKeyCustody implements KeyCustody {
  constructor(private readonly db: Database, private readonly masterKey: Uint8Array) {
    if (masterKey.length !== 32) throw new Error('Chiave principale della custodia: servono 32 byte');
  }

  async store(vaultId: string, purpose: CustodyPurpose, half: Uint8Array): Promise<string> {
    const [row] = await this.db
      .insert(custodyKeys)
      .values({ vaultId, purpose, sealed: { pending: true } })
      .returning({ ref: custodyKeys.ref });
    const ref = row!.ref;
    const sealed = await seal(this.masterKey, half, `custody:${ref}:${vaultId}:${purpose}`);
    await this.db.update(custodyKeys).set({ sealed }).where(eq(custodyKeys.ref, ref));
    return ref;
  }

  async reveal(ref: string): Promise<Uint8Array> {
    const [row] = await this.db.select().from(custodyKeys).where(eq(custodyKeys.ref, ref)).limit(1);
    if (!row) throw new Error('Chiave non trovata nella custodia');
    return open(this.masterKey, row.sealed as Envelope, `custody:${row.ref}:${row.vaultId}:${row.purpose}`);
  }

  async destroy(ref: string): Promise<void> {
    await this.db.delete(custodyKeys).where(and(eq(custodyKeys.ref, ref)));
  }
}

/** Sviluppo: legge la chiave principale da file, creandola al primo avvio. */
export async function loadDevMasterKey(path: string): Promise<Uint8Array> {
  const p = resolve(path);
  if (existsSync(p)) return new Uint8Array(Buffer.from((await readFile(p, 'utf8')).trim(), 'base64url'));
  const key = randomBytes(32);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, key.toString('base64url'), { mode: 0o600 });
  return new Uint8Array(key);
}
