ALTER TABLE "items" DROP CONSTRAINT "items_letter_recipient_id_persons_id_fk";
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "letter_recipient_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "letters_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "items" SET "letter_recipient_ids" = ARRAY["letter_recipient_id"] WHERE "letter_recipient_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "letter_recipient_id";