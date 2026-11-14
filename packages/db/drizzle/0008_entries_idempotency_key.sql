ALTER TABLE "entries" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_author_idempotency_key_unique" UNIQUE("author_id","idempotency_key");