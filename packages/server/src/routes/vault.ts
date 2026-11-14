import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client';
import { auditLog, checkinSchedules, itemFiles, items, passkeyCredentials, users, vaultKeyWraps, vaults } from '../db/schema';
import { blobKey, type BlobStore } from '../storage/blobs';
import { requireWritablePlan } from '../payments/subscriptions';
import { requireUser } from './auth';
import { verifierHash } from './recovery';

/** Dimensione massima di un file cifrato accettato (25 MB di contenuto + intestazione). */
export const MAX_ENCRYPTED_FILE_BYTES = 25 * 1024 * 1024 + 64;

const Envelope = z.object({
  v: z.literal(1),
  alg: z.literal('xchacha20poly1305-ietf'),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  ct: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200_000),
});

const AccessWrap = z.object({
  metodo: z.enum(['passkey', 'password', 'recovery-code']),
  credentialId: z.string().max(1024).optional(),
  parametri: z
    .object({
      alg: z.literal('argon2id13'),
      salt: z.string().max(64),
      opslimit: z.number().int().min(2).max(10),
      memlimit: z.number().int().min(16 * 1024 * 1024).max(1024 * 1024 * 1024),
    })
    .optional(),
  chiaveCifrata: Envelope,
});

const CreateVault = z.object({
  id: z.string().uuid(),
  chiavePubblica: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  chiavePrivataCifrata: Envelope,
  accessi: z.array(AccessWrap).min(2).max(10),
  /** Verificatore del codice di recupero (vedi @memoriae/crypto recoveryVerifier). */
  verificaRecupero: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

const ReplaceAccess = z.object({
  metodo: z.enum(['passkey', 'password']),
  credentialId: z.string().max(1024).optional(),
  parametri: AccessWrap.shape.parametri,
  chiaveCifrata: Envelope,
});

const ItemType = z.enum(['account', 'documento', 'cartella', 'istruzione', 'crypto', 'dispositivo']);
const CreateItem = z.object({
  id: z.string().uuid(),
  tipo: ItemType,
  emergenza: z.boolean().default(false),
  chiaveVoceCifrata: Envelope,
  contenuto: Envelope,
});
const UpdateItem = z.object({ contenuto: Envelope.optional(), emergenza: z.boolean().optional() });
const IdParam = z.object({ id: z.string().uuid() });

export interface VaultRouteOptions {
  db: Database;
  blobs: BlobStore;
}

export async function vaultRoutes(app: FastifyInstance, opts: VaultRouteOptions) {
  const { db, blobs } = opts;
  const auth = requireUser(db);
  // Dopo la prova senza piano: si legge e si cancella, non si aggiunge né si modifica.
  const piano = requireWritablePlan(db);

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_ENCRYPTED_FILE_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  async function ownVault(userId: string) {
    const [v] = await db.select().from(vaults).where(eq(vaults.ownerId, userId)).limit(1);
    return v ?? null;
  }

  const log = (actor: string, action: string, vaultId: string, details: Record<string, unknown> = {}) =>
    db.insert(auditLog).values({ actor, action, vaultId, details });

  // ---- Cassaforte -----------------------------------------------------------

  app.post('/v1/cassaforte', { preHandler: auth }, async (req, reply) => {
    const body = CreateVault.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Dati della cassaforte non validi' });
    const user = req.user!;
    if (await ownVault(user.id)) return reply.code(409).send({ errore: 'La cassaforte esiste già' });

    const methods = body.data.accessi.map((a) => a.metodo);
    if (!methods.includes('recovery-code')) {
      return reply.code(400).send({ errore: 'Serve il codice di recupero' });
    }
    if (!methods.some((m) => m === 'passkey' || m === 'password')) {
      return reply.code(400).send({ errore: 'Serve un metodo d\'accesso: passkey o password' });
    }
    for (const a of body.data.accessi) {
      if (a.metodo === 'password' && !a.parametri) return reply.code(400).send({ errore: 'Parametri della password mancanti' });
      if (a.metodo === 'passkey') {
        if (!a.credentialId) return reply.code(400).send({ errore: 'Passkey non indicata' });
        const [c] = await db
          .select({ id: passkeyCredentials.id })
          .from(passkeyCredentials)
          .where(and(eq(passkeyCredentials.id, a.credentialId), eq(passkeyCredentials.userId, user.id)));
        if (!c) return reply.code(400).send({ errore: 'Passkey non tua' });
      }
    }

    await db.transaction(async (tx) => {
      await tx.insert(vaults).values({ id: body.data.id, ownerId: user.id, recoveryVerifierHash: verifierHash(body.data.verificaRecupero) });
      await tx.insert(vaultKeyWraps).values(
        body.data.accessi.map((a) => ({
          vaultId: body.data.id,
          method: a.metodo,
          credentialId: a.credentialId ?? null,
          kdfParams: a.parametri ?? null,
          wrappedVaultKey: a.chiaveCifrata,
        })),
      );
      await tx
        .update(users)
        .set({ publicKey: body.data.chiavePubblica, wrappedPrivateKey: body.data.chiavePrivataCifrata })
        .where(eq(users.id, user.id));
      await tx.insert(checkinSchedules).values({ vaultId: body.data.id });
      await tx.insert(auditLog).values({ actor: user.id, action: 'cassaforte-creata', vaultId: body.data.id, details: { metodi: methods } });
    });
    return reply.code(201).send({ id: body.data.id });
  });

  app.get('/v1/cassaforte', { preHandler: auth }, async (req, reply) => {
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    const wraps = await db.select().from(vaultKeyWraps).where(eq(vaultKeyWraps.vaultId, v.id));
    const [u] = await db.select({ pk: users.publicKey, sk: users.wrappedPrivateKey }).from(users).where(eq(users.id, req.user!.id));
    return {
      id: v.id,
      chiavePubblica: u?.pk,
      chiavePrivataCifrata: u?.sk,
      accessi: wraps.map((w) => ({ metodo: w.method, credentialId: w.credentialId, parametri: w.kdfParams, chiaveCifrata: w.wrappedVaultKey })),
    };
  });

  /** Aggiunge o sostituisce un accesso: una nuova passkey (dopo un recupero o su un altro dispositivo) o la password. */
  app.put('/v1/cassaforte/accessi', { preHandler: auth }, async (req, reply) => {
    const body = ReplaceAccess.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Accesso non valido' });
    const user = req.user!;
    const v = await ownVault(user.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    const a = body.data;
    if (a.metodo === 'passkey') {
      if (!a.credentialId) return reply.code(400).send({ errore: 'Passkey non indicata' });
      const [c] = await db
        .select({ id: passkeyCredentials.id })
        .from(passkeyCredentials)
        .where(and(eq(passkeyCredentials.id, a.credentialId), eq(passkeyCredentials.userId, user.id)));
      if (!c) return reply.code(400).send({ errore: 'Passkey non tua' });
    } else if (!a.parametri) {
      return reply.code(400).send({ errore: 'Parametri della password mancanti' });
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(vaultKeyWraps)
        .where(
          a.metodo === 'passkey'
            ? and(eq(vaultKeyWraps.vaultId, v.id), eq(vaultKeyWraps.method, 'passkey'), eq(vaultKeyWraps.credentialId, a.credentialId!))
            : and(eq(vaultKeyWraps.vaultId, v.id), eq(vaultKeyWraps.method, 'password')),
        );
      await tx.insert(vaultKeyWraps).values({
        vaultId: v.id,
        method: a.metodo,
        credentialId: a.credentialId ?? null,
        kdfParams: a.parametri ?? null,
        wrappedVaultKey: a.chiaveCifrata,
      });
      await tx.insert(auditLog).values({ actor: user.id, action: 'accesso-aggiunto', vaultId: v.id, details: { metodo: a.metodo } });
    });
    return { ok: true };
  });

  // ---- Voci -----------------------------------------------------------------

  app.get('/v1/cassaforte/voci', { preHandler: auth }, async (req, reply) => {
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    const rows = await db.select().from(items).where(eq(items.vaultId, v.id)).orderBy(asc(items.createdAt));
    const files = await filesOfVault(v.id);
    return {
      voci: rows.map((r) => ({
        id: r.id,
        tipo: r.type,
        emergenza: r.isEmergency,
        chiaveVoceCifrata: r.wrappedItemKey,
        contenuto: r.content,
        file: files.get(r.id) ?? [],
        creataIl: r.createdAt,
        modificataIl: r.updatedAt,
      })),
    };
  });

  app.post('/v1/cassaforte/voci', { preHandler: [auth, piano] }, async (req, reply) => {
    const body = CreateItem.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Voce non valida' });
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    await db.insert(items).values({
      id: body.data.id,
      vaultId: v.id,
      type: body.data.tipo,
      isEmergency: body.data.emergenza,
      wrappedItemKey: body.data.chiaveVoceCifrata,
      content: body.data.contenuto,
    });
    await log(req.user!.id, 'voce-creata', v.id, { voce: body.data.id, tipo: body.data.tipo });
    return reply.code(201).send({ id: body.data.id });
  });

  async function ownItem(userId: string, itemId: string) {
    const v = await ownVault(userId);
    if (!v) return null;
    const [it] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.vaultId, v.id))).limit(1);
    return it ? { vault: v, item: it } : null;
  }

  app.patch('/v1/cassaforte/voci/:id', { preHandler: [auth, piano] }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    const body = UpdateItem.safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownItem(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Voce non trovata' });
    await db
      .update(items)
      .set({
        ...(body.data.contenuto ? { content: body.data.contenuto } : {}),
        ...(body.data.emergenza !== undefined ? { isEmergency: body.data.emergenza } : {}),
        updatedAt: new Date(),
      })
      .where(eq(items.id, p.data.id));
    await log(req.user!.id, 'voce-modificata', found.vault.id, { voce: p.data.id });
    return { ok: true };
  });

  app.delete('/v1/cassaforte/voci/:id', { preHandler: auth }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownItem(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Voce non trovata' });
    for (const f of await db.select().from(itemFiles).where(eq(itemFiles.itemId, p.data.id))) await blobs.delete(f.blobKey);
    if (found.item.blobKey) await blobs.delete(found.item.blobKey);
    await db.delete(items).where(eq(items.id, p.data.id));
    await log(req.user!.id, 'voce-eliminata', found.vault.id, { voce: p.data.id });
    return { ok: true };
  });

  // ---- File cifrati (più file per voce) ---------------------------------------

  const FileParam = z.object({ id: z.string().uuid(), fileId: z.string().uuid() });

  app.put('/v1/cassaforte/voci/:id/file/:fileId', { preHandler: [auth, piano] }, async (req, reply) => {
    const p = FileParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ errore: 'Atteso un file cifrato (application/octet-stream)' });
    const bytes = new Uint8Array(req.body);
    // Il server non può leggere il file, ma controlla almeno che sia nel formato cifrato di MEMORIAE.
    if (bytes.length < 4 + 24 + 16 || bytes[0] !== 0x4d || bytes[1] !== 0x45 || bytes[2] !== 0x4d || bytes[3] !== 0x31) {
      return reply.code(400).send({ errore: 'Il file non risulta cifrato' });
    }
    const found = await ownItem(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Voce non trovata' });
    const esistenti = await db.select().from(itemFiles).where(eq(itemFiles.itemId, p.data.id));
    const giaPresente = esistenti.find((f) => f.id === p.data.fileId);
    if (!giaPresente && esistenti.length >= MAX_FILES_PER_ITEM) {
      return reply.code(409).send({ errore: `Al massimo ${MAX_FILES_PER_ITEM} file per voce` });
    }
    const key = blobKey(found.vault.id, p.data.fileId);
    await blobs.put(key, bytes);
    if (giaPresente) {
      await db.update(itemFiles).set({ size: bytes.length }).where(eq(itemFiles.id, p.data.fileId));
    } else {
      await db.insert(itemFiles).values({ id: p.data.fileId, itemId: p.data.id, vaultId: found.vault.id, blobKey: key, size: bytes.length });
    }
    await db.update(items).set({ updatedAt: new Date() }).where(eq(items.id, p.data.id));
    await log(req.user!.id, 'file-caricato', found.vault.id, { voce: p.data.id, file: p.data.fileId, byte: bytes.length });
    return { ok: true, byte: bytes.length };
  });

  app.get('/v1/cassaforte/voci/:id/file/:fileId', { preHandler: auth }, async (req, reply) => {
    const p = FileParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownItem(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'File non trovato' });
    return sendItemFile(db, blobs, p.data.id, p.data.fileId, reply);
  });

  /** Togliere un file è come cancellare: si può fare anche senza piano attivo. */
  app.delete('/v1/cassaforte/voci/:id/file/:fileId', { preHandler: auth }, async (req, reply) => {
    const p = FileParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownItem(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Voce non trovata' });
    const [f] = await db.select().from(itemFiles).where(and(eq(itemFiles.id, p.data.fileId), eq(itemFiles.itemId, p.data.id)));
    if (!f) return reply.code(404).send({ errore: 'File non trovato' });
    await blobs.delete(f.blobKey);
    await db.delete(itemFiles).where(eq(itemFiles.id, f.id));
    await log(req.user!.id, 'file-eliminato', found.vault.id, { voce: p.data.id, file: f.id });
    return { ok: true };
  });

  async function filesOfVault(vaultId: string) {
    const rows = await db.select().from(itemFiles).where(eq(itemFiles.vaultId, vaultId)).orderBy(asc(itemFiles.createdAt));
    const map = new Map<string, { id: string; byte: number }[]>();
    for (const f of rows) map.set(f.itemId, [...(map.get(f.itemId) ?? []), { id: f.id, byte: f.size }]);
    return map;
  }
}

export const MAX_FILES_PER_ITEM = 20;

/** Elenco dei file per voce (id e dimensione): il nome è nel contenuto cifrato. */
export async function filesByItem(db: Database, itemIds: string[]) {
  const map = new Map<string, { id: string; byte: number }[]>();
  if (itemIds.length === 0) return map;
  const rows = await db.select().from(itemFiles).where(inArray(itemFiles.itemId, itemIds)).orderBy(asc(itemFiles.createdAt));
  for (const f of rows) map.set(f.itemId, [...(map.get(f.itemId) ?? []), { id: f.id, byte: f.size }]);
  return map;
}

/** Invia un file cifrato di una voce (il chiamante ha già controllato chi può leggerlo). */
export async function sendItemFile(db: Database, blobs: BlobStore, itemId: string, fileId: string, reply: FastifyReply) {
  const [f] = await db.select().from(itemFiles).where(and(eq(itemFiles.id, fileId), eq(itemFiles.itemId, itemId))).limit(1);
  const bytes = f && (await blobs.get(f.blobKey));
  if (!bytes) return reply.code(404).send({ errore: 'File non trovato' });
  return reply.type('application/octet-stream').send(Buffer.from(bytes));
}
