import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Carica il file .env nella cartella principale del progetto, se esiste (le variabili già impostate vincono). */
export function loadEnvFile(): void {
  const path = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL mancante'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Dominio su cui valgono le passkey (es. app.memoriae.ch). */
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  /** Indirizzi da cui si apre l'app, separati da virgola. */
  WEBAUTHN_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  /** Cookie solo su HTTPS: sempre vero in produzione. */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Cartella dei file cifrati (sviluppo). In produzione: object storage S3. */
  BLOB_DIR: z.string().default('./data/file'),
  /** Sviluppo: le e-mail finiscono in questo file e nel terminale. In produzione: SMTP (da aggiungere). */
  MAIL_OUTBOX: z.string().default('./data/posta.log'),
});

export type Config = Omit<z.infer<typeof ConfigSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

/** Legge la configurazione dalle variabili d'ambiente e si ferma subito se qualcosa manca. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configurazione non valida: ${problems}`);
  }
  const c = parsed.data;
  const cookieSecure = c.COOKIE_SECURE ?? c.NODE_ENV === 'production';
  if (c.NODE_ENV === 'production' && !cookieSecure) {
    throw new Error('Configurazione non valida: in produzione i cookie devono essere sicuri (HTTPS)');
  }
  return { ...c, COOKIE_SECURE: cookieSecure };
}
