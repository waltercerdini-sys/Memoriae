ALTER TYPE "public"."item_type" ADD VALUE 'ricordo';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "memories_reminder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "memories_reminder_sent_at" timestamp with time zone;