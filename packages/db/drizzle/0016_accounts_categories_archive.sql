ALTER TABLE "accounts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_per_partnership_unique" UNIQUE("partnership_id","name");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_shape" CHECK ("accounts"."name" = btrim("accounts"."name") AND char_length("accounts"."name") BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_shape" CHECK ("categories"."name" = btrim("categories"."name") AND char_length("categories"."name") BETWEEN 1 AND 60);--> statement-breakpoint

-- Entries point at accounts and categories and never change, so the app
-- archives them instead (0006 grants DELETE on every new table).
REVOKE DELETE ON accounts, categories FROM partneroj_app;
