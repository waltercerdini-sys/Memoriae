ALTER TYPE "public"."card_status" ADD VALUE 'magazzino';--> statement-breakpoint
CREATE TABLE "card_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"supplier" text,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "uid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "vault_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "qr_code" text;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_batch_id_card_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."card_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_qr_idx" ON "cards" USING btree ("qr_code");