CREATE TYPE "public"."card_order_status" AS ENUM('in-attesa', 'pagato', 'spedito', 'annullato');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('spedita', 'attiva', 'disattivata');--> statement-breakpoint
CREATE TABLE "card_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"amount_chf" integer NOT NULL,
	"status" "card_order_status" DEFAULT 'in-attesa' NOT NULL,
	"gift" boolean DEFAULT false NOT NULL,
	"shipping_name" text,
	"shipping_line1" text,
	"shipping_line2" text,
	"shipping_postal_code" text,
	"shipping_city" text,
	"shipping_country" text,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"tracking" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_taps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uid" text NOT NULL,
	"vault_id" uuid NOT NULL,
	"order_id" uuid,
	"status" "card_status" DEFAULT 'spedita' NOT NULL,
	"last_counter" integer DEFAULT -1 NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_orders" ADD CONSTRAINT "card_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_orders" ADD CONSTRAINT "card_orders_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_taps" ADD CONSTRAINT "card_taps_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_taps_token_idx" ON "card_taps" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_uid_idx" ON "cards" USING btree ("uid");