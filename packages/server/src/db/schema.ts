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

/** Passkey registrate (WebAuthn). Il server conserva solo la chiave pubblica della passkey. */
export const passkeyCredentials = pgTable('passkey_credentials', {
  id: text('id').primaryKey(), // credential ID, base64url
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(), // base64url (COSE)
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: jsonb('transports').notNull().default(sql`'[]'::jsonb`),
  deviceType: text('device_type'),
  backedUp: boolean('backed_up').notNull().default(false),
  label: text('label'),
  createdAt: createdAt(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (t) => [index('passkey_credentials_user_idx').on(t.userId)]);

/** Sfide WebAuthn in corso: valgono pochi minuti e una volta sola. */
export const authChallenges = pgTable('auth_challenges', {
  id: id(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull(), // 'registrazione' | 'accesso'
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Sessioni: nel database solo l'hash del token, il token sta nel cookie. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

/**
 * Richieste di recupero dell'accesso (passkey persa).
 * Servono due prove: il codice ricevuto per e-mail e il codice di recupero stampato.
 */
export const recoveryRequests = pgTable('recovery_requests', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emailCodeHash: text('email_code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  /** Token della fase successiva, dopo la verifica dell'e-mail (solo hash). */
  tokenHash: text('token_hash'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('recovery_requests_user_idx').on(t.userId)]);

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
  /** SHA-256 del verificatore del codice di recupero: prova che chi recupera possiede il codice, senza poterlo usare. */
  recoveryVerifierHash: text('recovery_verifier_hash'),
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
  /** Invito in corso: solo l'hash del token inviato per e-mail. */
  inviteTokenHash: text('invite_token_hash'),
  inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
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
  /** Strato interno consegnato (cifrato per il destinatario) e il caso che l'ha sbloccato. */
  deliveredInner: text('delivered_inner'),
  activationCaseId: uuid('activation_case_id'),
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
  /** Token del collegamento «sono qui» nelle e-mail (solo hash), valido fino al prossimo controllo. */
  checkinTokenHash: text('checkin_token_hash'),
  /** Quando i fiduciari sono stati avvisati del controllo mancato (una volta per periodo). */
  missedNotifiedAt: timestamp('missed_notified_at', { withTimezone: true }),
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
  /** Spiegazione del fiduciario (testo libero, lo legge l'operatore). */
  reason: text('reason'),
  /** Collegamento «blocca» inviato al proprietario (solo hash). */
  blockTokenHash: text('block_token_hash'),
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

/**
 * Custodia delle metà MEMORIAE (solo per sviluppo e prove).
 * In produzione queste metà vanno in un servizio di gestione chiavi separato (KMS o modulo hardware),
 * non nel database dell'applicazione. Qui sono cifrate con una chiave principale fuori dal database.
 */
export const custodyKeys = pgTable('custody_keys', {
  ref: uuid('ref').primaryKey().default(sql`gen_random_uuid()`),
  vaultId: uuid('vault_id').notNull().references(() => vaults.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(), // decesso | emergenza | recupero-sociale
  sealed: jsonb('sealed').notNull(),
  createdAt: createdAt(),
}, (t) => [index('custody_keys_vault_idx').on(t.vaultId)]);

// ---------------------------------------------------------------------------
// Abbonamenti e pagamenti (TWINT e carte tramite il fornitore di pagamento)
// ---------------------------------------------------------------------------

export const planEnum = pgEnum('plan', ['essenziale', 'famiglia']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['prova', 'attivo', 'in-ritardo', 'annullato']);

/**
 * Un abbonamento per utente. Il fornitore di pagamento (Stripe) è la fonte di verità per
 * importi, fatture e rinnovi; qui teniamo solo lo stato necessario a MEMORIAE.
 * Nessun dato di carta o di conto passa da MEMORIAE.
 */
export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  plan: planEnum('plan'),
  status: subscriptionStatusEnum('status').notNull().default('prova'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }).notNull(),
  /** Fine del periodo pagato (rinnovo o scadenza). */
  paidUntil: timestamp('paid_until', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  /** Piano Famiglia: e-mail del secondo adulto coperto dallo stesso abbonamento. */
  familyMemberEmail: text('family_member_email'),
  trialReminderSentAt: timestamp('trial_reminder_sent_at', { withTimezone: true }),
  trialEndedNoticeAt: timestamp('trial_ended_notice_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('subscriptions_customer_idx').on(t.providerCustomerId),
  index('subscriptions_family_idx').on(t.familyMemberEmail),
]);

/** Eventi del fornitore già elaborati: lo stesso avviso ricevuto due volte non conta due volte. */
export const paymentEvents = pgTable('payment_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Pagamenti di prova (solo sviluppo): simulano la pagina TWINT del fornitore. */
export const trialCheckouts = pgTable('trial_checkouts', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  plan: planEnum('plan').notNull(),
  amountChf: integer('amount_chf').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: createdAt(),
});
