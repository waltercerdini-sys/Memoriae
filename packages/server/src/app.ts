import cookie from '@fastify/cookie';
import { asc, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PasskeyService } from './auth/passkeys';
import type { Database } from './db/client';
import { providers } from './db/schema';
import type { Mailer } from './mail/mailer';
import { activationRoutes, type ActivationOptions } from './routes/activation';
import { authRoutes } from './routes/auth';
import { checkinRoutes } from './routes/checkin';
import { personRoutes } from './routes/persons';
import { recoveryRoutes } from './routes/recovery';
import type { KeyCustody } from './storage/custody';
import { vaultRoutes } from './routes/vault';
import type { BlobStore } from './storage/blobs';

export interface AppOptions {
  db: Database;
  passkeys: PasskeyService;
  blobs: BlobStore;
  mailer: Mailer;
  custody: KeyCustody;
  /** Indirizzo dell'app, per i collegamenti nelle e-mail. */
  appOrigin: string;
  cookieSecure: boolean;
  logLevel?: string;
  /** Operatori, chiave dei documenti, attesa di prova. Predefinito: modalità prova con chiave casuale. */
  activation?: ActivationOptions;
}

export function buildApp({ db, passkeys, blobs, mailer, custody, appOrigin, cookieSecure, logLevel = 'info', activation }: AppOptions): FastifyInstance {
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
  app.register(recoveryRoutes, { db, passkeys, mailer, cookieSecure });
  app.register(personRoutes, { db, mailer, custody, appOrigin });
  app.register(checkinRoutes, { db });
  app.register(activationRoutes, { db, mailer, custody, blobs, appOrigin, ...(activation ?? { operatori: [], chiaveDocumenti: new Uint8Array(randomBytes(32)) }) });

  return app;
}
