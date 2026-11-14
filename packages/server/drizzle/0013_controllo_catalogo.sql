ALTER TABLE "providers" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "source_pending_hash" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "source_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "source_status" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;