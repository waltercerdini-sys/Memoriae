CREATE TYPE "public"."access_method" AS ENUM('passkey', 'password', 'recovery-code', 'social-recovery');--> statement-breakpoint
CREATE TYPE "public"."activation_status" AS ENUM('richiesta', 'in-verifica', 'respinta', 'in-attesa', 'bloccata', 'rilasciata');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('da-invitare', 'invitato', 'accettato', 'rifiutato', 'revocato');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('account', 'documento', 'cartella', 'istruzione', 'crypto', 'dispositivo');--> statement-breakpoint
CREATE TYPE "public"."package_kind" AS ENUM('sealed-to-recipient', 'release-only');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('fiduciario', 'destinatario', 'fiduciario-destinatario');--> statement-breakpoint
CREATE TYPE "public"."release_scope" AS ENUM('decesso', 'emergenza');--> statement-breakpoint
CREATE TABLE "activation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"scope" "release_scope" NOT NULL,
	"status" "activation_status" DEFAULT 'richiesta' NOT NULL,
	"requested_by" uuid NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"waiting_until" timestamp with time zone,
	"released_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"vault_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkin_schedules" (
	"vault_id" uuid PRIMARY KEY NOT NULL,
	"interval_days" integer DEFAULT 30 NOT NULL,
	"max_reminders" integer DEFAULT 3 NOT NULL,
	"reminder_spacing_days" integer DEFAULT 3 NOT NULL,
	"last_checkin_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"paused" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrity_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"chain" text DEFAULT 'polygon' NOT NULL,
	"tx_hash" text,
	"anchored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"type" "item_type" NOT NULL,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"wrapped_item_key" jsonb NOT NULL,
	"content" jsonb,
	"blob_key" text,
	"blob_size" bigint,
	"provider_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_clients" (
	"partner_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"brand_name" text,
	"seat_limit" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"user_id" uuid,
	"role" "person_role" NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"invite_status" "invite_status" DEFAULT 'da-invitare' NOT NULL,
	"public_key" text,
	"sealed_fiduciary_half" text,
	"sealed_recovery_share" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"living_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"heir_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_url" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipient_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"scope" "release_scope" NOT NULL,
	"kind" "package_kind" NOT NULL,
	"outer" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"language" text DEFAULT 'it' NOT NULL,
	"public_key" text,
	"wrapped_private_key" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_key_wraps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"method" "access_method" NOT NULL,
	"credential_id" text,
	"kdf_params" jsonb,
	"wrapped_vault_key" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"release_owner_copy" jsonb,
	"kms_ref_decesso" text,
	"kms_ref_emergenza" text,
	"kms_ref_social_recovery" text,
	"social_recovery_threshold" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activation_cases" ADD CONSTRAINT "activation_cases_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_cases" ADD CONSTRAINT "activation_cases_requested_by_persons_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_schedules" ADD CONSTRAINT "checkin_schedules_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_anchors" ADD CONSTRAINT "integrity_anchors_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_clients" ADD CONSTRAINT "partner_clients_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_clients" ADD CONSTRAINT "partner_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_packages" ADD CONSTRAINT "recipient_packages_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_packages" ADD CONSTRAINT "recipient_packages_recipient_id_persons_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_key_wraps" ADD CONSTRAINT "vault_key_wraps_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_cases_vault_idx" ON "activation_cases" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "audit_log_vault_idx" ON "audit_log" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "items_vault_idx" ON "items" USING btree ("vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_clients_pk" ON "partner_clients" USING btree ("partner_id","user_id");--> statement-breakpoint
CREATE INDEX "persons_vault_idx" ON "persons" USING btree ("vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "providers_slug_idx" ON "providers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "recipient_packages_unique" ON "recipient_packages" USING btree ("vault_id","recipient_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "vault_key_wraps_vault_idx" ON "vault_key_wraps" USING btree ("vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_owner_idx" ON "vaults" USING btree ("owner_id");