import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client';
import { auditLog, checkinSchedules, items, passkeyCredentials, users, vaultKeyWraps, vaults } from '../db/schema';
import { blobKey, type BlobStore } from '../storage/blobs';
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
    return {
      voci: rows.map((r) => ({
        id: r.id,
        tipo: r.type,
        emergenza: r.isEmergency,
        chiaveVoceCifrata: r.wrappedItemKey,
        contenuto: r.content,
        haFile: !!r.blobKey,
        dimensioneFile: r.blobSize,
        creataIl: r.createdAt,
        modificataIl: r.updatedAt,
      })),
    };
  });

  app.post('/v1/cassaforte/voci', { preHandler: auth }, async (req, reply) => {
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

  app.patch('/v1/cassaforte/voci/:id', { preHandler: auth }, async (req, reply) => {
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
    if (found.item.blobKey) await blobs.delete(found.item.blobKey);
    await db.delete(items).where(eq(items.id, p.data.id));
    await log(req.user!.id, 'voce-eliminata', found.vault.id, { voce: p.data.id });
    return { ok: true };
  });

  // ---- File cifrati ---------------------------------------------------------

  app.put('/v1/cassaforte/voci/:id/file', { preHandler: auth }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ errore: 'Atteso un file cifrato (application/octet-stream)' });
    const bytes = new Uint8Array(req.body);
    // Il server non può leggere il file, ma controlla almeno che sia nel formato cifrato di MEMORIAE.
    if (bytes.length < 4 + 24 + 16 || bytes[0] !== 0x4d || bytes[1] !== 0x45 || bytes[2] !== 0x4d || bytes[3] !== 0x31) {
      return reply.code(400).send({ errore: 'Il file non risulta cifrato' });
    }
    const found = await ownItem(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Voce non trovata' });
    const key = blobKey(found.vault.id, p.data.id);
    await blobs.put(key, bytes);
    await db.update(items).set({ blobKey: key, blobSize: bytes.length, updatedAt: new Date() }).where(eq(items.id, p.data.id));
    await log(req.user!.id, 'file-caricato', found.vault.id, { voce: p.data.id, byte: bytes.length });
    return { ok: true, byte: bytes.length };
  });

  app.get('/v1/cassaforte/voci/:id/file', { preHandler: auth }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownItem(req.user!.id, p.data.id);
    if (!found?.item.blobKey) return reply.code(404).send({ errore: 'File non trovato' });
    const bytes = await blobs.get(found.item.blobKey);
    if (!bytes) return reply.code(404).send({ errore: 'File non trovato' });
    return reply.type('application/octet-stream').send(Buffer.from(bytes));
  });
}
