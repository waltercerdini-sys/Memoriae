import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Schema del database di MEMORIAE.
 *
 * Regola: contenuti, titoli e volontà sono SEMPRE cifrati nel browser e arrivano qui come buste
 * (`Envelope` del pacchetto @memoriae/crypto, salvate in colonne jsonb).
 * In chiaro restano solo i dati necessari per contattare le persone e far funzionare
 * controlli periodici e attivazioni.
 *
 * Le metà MEMORIAE delle chiavi di rilascio NON stanno in questo database:
 * qui c'è solo il riferimento alla chiave nel servizio di gestione chiavi (KMS).
 */

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Utenti e cassaforte
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  language: text('language').notNull().default('it'),
  /** Chiave pubblica X25519 dell'utente (base64url). */
  publicKey: text('public_key'),
  /** Chiave privata cifrata con la chiave d'accesso. */
  wrappedPrivateKey: jsonb('wrapped_private_key'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('users_email_idx').on(t.email)]);

export const vaults = pgTable('vaults', {
  id: id(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  /** Copia del proprietario dei segreti di rilascio, cifrata con la chiave della cassaforte. */
  releaseOwnerCopy: jsonb('release_owner_copy'),
  /** Riferimenti alle metà MEMORIAE nel servizio di gestione chiavi (mai le metà stesse). */
  kmsRefDecesso: text('kms_ref_decesso'),
  kmsRefEmergenza: text('kms_ref_emergenza'),
  kmsRefSocialRecovery: text('kms_ref_social_recovery'),
  socialRecoveryThreshold: integer('social_recovery_threshold'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('vaults_owner_idx').on(t.ownerId)]);

export const accessMethodEnum = pgEnum('access_method', ['passkey', 'password', 'recovery-code', 'social-recovery']);

/** Le copie cifrate della chiave della cassaforte, una per metodo d'accesso. */
export const vaultKeyWraps = pgTable('vault_key_wraps', {
  id: id(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  method: accessMethodEnum('method').notNull(),
  /** Per le passkey: id della credenziale WebAuthn. */
  credentialId: text('credential_id'),
  /** Per le password: parametri Argon2id (sale, costi). */
  kdfParams: jsonb('kdf_params'),
  wrappedVaultKey: jsonb('wrapped_vault_key').notNull(),
  createdAt: createdAt(),
}, (t) => [index('vault_key_wraps_vault_idx').on(t.vaultId)]);

export const itemTypeEnum = pgEnum('item_type', ['account', 'documento', 'cartella', 'istruzione', 'crypto', 'dispositivo']);

/** Una voce dell'inventario. Del contenuto il server vede solo tipo, dimensione e date. */
export const items = pgTable('items', {
  id: id(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  type: itemTypeEnum('type').notNull(),
  isEmergency: boolean('is_emergency').notNull().default(false),
  wrappedItemKey: jsonb('wrapped_item_key').notNull(),
  /** Contenuto piccolo cifrato (testo, metadati). */
  content: jsonb('content'),
  /** Riferimento al file cifrato nell'archivio oggetti, se la voce ha un file. */
  blobKey: text('blob_key'),
  blobSize: bigint('blob_size', { mode: 'number' }),
  /** Fornitore del catalogo a cui si riferisce la voce, se è un account. */
  providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('items_vault_idx').on(t.vaultId)]);

// ---------------------------------------------------------------------------
// Persone, chiavi e pacchetti
// ---------------------------------------------------------------------------

export const personRoleEnum = pgEnum('person_role', ['fiduciario', 'destinatario', 'fiduciario-destinatario']);
export const inviteStatusEnum = pgEnum('invite_status', ['da-invitare', 'invitato', 'accettato', 'rifiutato', 'revocato']);

export const persons = pgTable('persons', {
  id: id(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  /** Collegamento all'account, quando la persona si registra. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  role: personRoleEnum('role').notNull(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  inviteStatus: inviteStatusEnum('invite_status').notNull().default('da-invitare'),
  publicKey: text('public_key'),
  /** Metà fiduciari della chiave di rilascio, cifrata per questa persona. */
  sealedFiduciaryHalf: text('sealed_fiduciary_half'),
  /** Quota di recupero sociale, cifrata per questa persona. */
  sealedRecoveryShare: text('sealed_recovery_share'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('persons_vault_idx').on(t.vaultId)]);

export const releaseScopeEnum = pgEnum('release_scope', ['decesso', 'emergenza']);
export const packageKindEnum = pgEnum('package_kind', ['sealed-to-recipient', 'release-only']);

export const recipientPackages = pgTable('recipient_packages', {
  id: id(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  recipientId: uuid('recipient_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  scope: releaseScopeEnum('scope').notNull(),
  kind: packageKindEnum('kind').notNull(),
  outer: jsonb('outer').notNull(),
  /** Quando il pacchetto è stato consegnato al destinatario dopo un rilascio. */
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('recipient_packages_unique').on(t.vaultId, t.recipientId, t.scope)]);

// ---------------------------------------------------------------------------
// Controllo periodico e attivazione
// ---------------------------------------------------------------------------

export const checkinSchedules = pgTable('checkin_schedules', {
  vaultId: uuid('vault_id').primaryKey().references(() => vaults.id, { onDelete: 'cascade' }),
  intervalDays: integer('interval_days').notNull().default(30),
  /** Promemoria da inviare prima di considerare il controllo mancato. */
  maxReminders: integer('max_reminders').notNull().default(3),
  reminderSpacingDays: integer('reminder_spacing_days').notNull().default(3),
  lastCheckinAt: timestamp('last_checkin_at', { withTimezone: true }).notNull().defaultNow(),
  remindersSent: integer('reminders_sent').notNull().default(0),
  lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
  paused: boolean('paused').notNull().default(false),
});

export const activationStatusEnum = pgEnum('activation_status', [
  'richiesta',
  'in-verifica',
  'respinta',
  'in-attesa',
  'bloccata',
  'rilasciata',
]);

export const activationCases = pgTable('activation_cases', {
  id: id(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  scope: releaseScopeEnum('scope').notNull(),
  status: activationStatusEnum('status').notNull().default('richiesta'),
  requestedBy: uuid('requested_by').notNull().references(() => persons.id, { onDelete: 'restrict' }),
  /** Documenti (certificato di morte, attestazione medica) cifrati per l'operatore. */
  documents: jsonb('documents').notNull().default(sql`'[]'::jsonb`),
  reviewedBy: text('reviewed_by'),
  reviewNote: text('review_note'),
  waitingUntil: timestamp('waiting_until', { withTimezone: true }),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  /** Per l'emergenza: fino a quando vale l'accesso. */
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('activation_cases_vault_idx').on(t.vaultId)]);

// ---------------------------------------------------------------------------
// Catalogo, partner, integrità, registro
// ---------------------------------------------------------------------------

export const providers = pgTable('providers', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  /** Come attivare la funzione di eredità da vivi (testo per l'utente). */
  livingSteps: jsonb('living_steps').notNull().default(sql`'[]'::jsonb`),
  /** Cosa devono fare gli eredi (testo per gli eredi e per il servizio eredi). */
  heirSteps: jsonb('heir_steps').notNull().default(sql`'[]'::jsonb`),
  sourceUrl: text('source_url'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('providers_slug_idx').on(t.slug)]);

export const partners = pgTable('partners', {
  id: id(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // studio notarile, fiduciaria, banca, impresa funebre
  brandName: text('brand_name'),
  seatLimit: integer('seat_limit').notNull().default(50),
  createdAt: createdAt(),
});

/** Il partner vede solo che il cliente esiste e lo stato dell'abbonamento, mai i contenuti. */
export const partnerClients = pgTable('partner_clients', {
  partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('partner_clients_pk').on(t.partnerId, t.userId)]);

export const integrityAnchors = pgTable('integrity_anchors', {
  id: id(),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  fingerprint: text('fingerprint').notNull(),
  chain: text('chain').notNull().default('polygon'),
  txHash: text('tx_hash'),
  anchoredAt: timestamp('anchored_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Registro eventi: si aggiunge, non si modifica (vincolo imposto anche da trigger nella migrazione). */
export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  vaultId: uuid('vault_id'),
  details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
}, (t) => [index('audit_log_vault_idx').on(t.vaultId)]);
