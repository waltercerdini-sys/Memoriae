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
  /** Indirizzo pubblico dell'app (collegamenti nelle e-mail). Predefinito: il primo di WEBAUTHN_ORIGINS. */
  APP_ORIGIN: z.string().url().optional(),
  /** Sviluppo: file con la chiave principale della custodia delle metà MEMORIAE. */
  CUSTODY_KEY_FILE: z.string().default('./data/custodia.key'),
  /** E-mail degli operatori MEMORIAE che verificano le richieste, separate da virgola. */
  OPERATOR_EMAILS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean)),
  /** Solo prove: attesa dopo la verifica, in secondi, al posto di 14 giorni / 72 ore. */
  ATTESA_PROVA_SECONDI: z.coerce.number().int().positive().optional(),
  /** Ogni quanto girano i lavori periodici (promemoria, rilasci), in secondi. */
  JOBS_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(300),
  /** Pagamenti: «prova» (sviluppo, nessun denaro) oppure «stripe» (TWINT e carte). */
  PAYMENTS_PROVIDER: z.enum(['prova', 'stripe']).default('prova'),
  /** Invio vero delle e-mail (SMTP). In prova è facoltativo: senza, le e-mail restano nel terminale. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Mittente, per esempio «MEMORIAE <info@memoriae.ch>». Predefinito: SMTP_USER. */
  MAIL_FROM: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ESSENZIALE: z.string().optional(),
  STRIPE_PRICE_FAMIGLIA: z.string().optional(),
});

export type Config = Omit<z.infer<typeof ConfigSchema>, 'COOKIE_SECURE' | 'APP_ORIGIN'> & { COOKIE_SECURE: boolean; APP_ORIGIN: string };

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
  if (c.NODE_ENV === 'production' && c.ATTESA_PROVA_SECONDI) {
    throw new Error('Configurazione non valida: in produzione l\'attesa non si può accorciare');
  }
  if (c.NODE_ENV === 'production' && c.OPERATOR_EMAILS.length === 0) {
    throw new Error('Configurazione non valida: in produzione servono gli operatori (OPERATOR_EMAILS)');
  }
  if (c.NODE_ENV === 'production' && c.PAYMENTS_PROVIDER !== 'stripe') {
    throw new Error('Configurazione non valida: in produzione i pagamenti di prova non sono ammessi');
  }
  if (c.SMTP_HOST && !(c.SMTP_USER && c.SMTP_PASSWORD)) {
    throw new Error('Configurazione non valida: con SMTP_HOST servono anche SMTP_USER e SMTP_PASSWORD');
  }
  if (c.NODE_ENV === 'production' && !c.SMTP_HOST) {
    throw new Error('Configurazione non valida: in produzione serve l\'invio e-mail (SMTP_HOST, SMTP_USER, SMTP_PASSWORD)');
  }
  if (c.PAYMENTS_PROVIDER === 'stripe' && !(c.STRIPE_SECRET_KEY && c.STRIPE_WEBHOOK_SECRET && c.STRIPE_PRICE_ESSENZIALE && c.STRIPE_PRICE_FAMIGLIA)) {
    throw new Error('Configurazione non valida: per Stripe servono STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET e i due prezzi');
  }
  return { ...c, COOKIE_SECURE: cookieSecure, APP_ORIGIN: c.APP_ORIGIN ?? c.WEBAUTHN_ORIGINS[0] ?? 'http://localhost:5173' };
}
