ALTER TYPE "public"."item_type" ADD VALUE 'lettera';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "deliver_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "letter_recipient_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "letter_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_letter_recipient_id_persons_id_fk" FOREIGN KEY ("letter_recipient_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;