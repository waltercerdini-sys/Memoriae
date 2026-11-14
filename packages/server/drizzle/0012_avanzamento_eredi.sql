CREATE TABLE "heir_progress" (
	"vault_id" uuid NOT NULL,
	"key" text NOT NULL,
	"done_by" uuid,
	"done_by_name" text NOT NULL,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heir_progress" ADD CONSTRAINT "heir_progress_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heir_progress" ADD CONSTRAINT "heir_progress_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "heir_progress_key_idx" ON "heir_progress" USING btree ("vault_id","key");