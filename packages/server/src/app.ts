import cookie from '@fastify/cookie';
import { asc, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PasskeyService } from './auth/passkeys';
import type { Database } from './db/client';
import { providers } from './db/schema';
import { authRoutes } from './routes/auth';
import { vaultRoutes } from './routes/vault';
import type { BlobStore } from './storage/blobs';

export interface AppOptions {
  db: Database;
  passkeys: PasskeyService;
  blobs: BlobStore;
  cookieSecure: boolean;
  logLevel?: string;
}

export function buildApp({ db, passkeys, blobs, cookieSecure, logLevel = 'info' }: AppOptions): FastifyInstance {
  // Nei log solo metodo, percorso e stato: mai corpi delle richieste né dati personali.
  const app = Fastify({ logger: { level: logLevel }, bodyLimit: 1024 * 1024 });

  app.register(cookie);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
  });

  app.get('/health', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { stato: 'ok' };
    } catch {
      return reply.code(503).send({ stato: 'database non raggiungibile' });
    }
  });

  /** Catalogo fornitori: unico contenuto pubblico di MEMORIAE. */
  app.get('/v1/fornitori', async () => {
    const rows = await db
      .select({
        slug: providers.slug,
        nome: providers.name,
        categoria: providers.category,
        daVivi: providers.livingSteps,
        perGliEredi: providers.heirSteps,
        fonte: providers.sourceUrl,
        verificatoIl: providers.verifiedAt,
      })
      .from(providers)
      .orderBy(asc(providers.name));
    return { fornitori: rows };
  });

  app.register(authRoutes, { db, passkeys, cookieSecure });
  app.register(vaultRoutes, { db, blobs });

  return app;
}
