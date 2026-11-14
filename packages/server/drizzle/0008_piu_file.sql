CREATE TABLE "item_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"vault_id" uuid NOT NULL,
	"blob_key" text NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_files" ADD CONSTRAINT "item_files_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_files" ADD CONSTRAINT "item_files_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_files_item_idx" ON "item_files" USING btree ("item_id");--> statement-breakpoint
-- I file già caricati (uno per voce) diventano il primo file della voce, con lo stesso identificativo della voce.
INSERT INTO "item_files" ("id", "item_id", "vault_id", "blob_key", "size", "created_at")
SELECT "id", "id", "vault_id", "blob_key", COALESCE("blob_size", 0), "updated_at" FROM "items" WHERE "blob_key" IS NOT NULL;
