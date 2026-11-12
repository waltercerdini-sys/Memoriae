ALTER TABLE "activation_cases" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "activation_cases" ADD COLUMN "block_token_hash" text;--> statement-breakpoint
ALTER TABLE "checkin_schedules" ADD COLUMN "checkin_token_hash" text;--> statement-breakpoint
ALTER TABLE "checkin_schedules" ADD COLUMN "missed_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recipient_packages" ADD COLUMN "delivered_inner" text;--> statement-breakpoint
ALTER TABLE "recipient_packages" ADD COLUMN "activation_case_id" uuid;