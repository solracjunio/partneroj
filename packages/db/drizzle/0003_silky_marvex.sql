CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_expire_after_creation" CHECK ("invites"."expires_at" > "invites"."created_at")
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entry_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "receipts_file_per_entry_unique" UNIQUE("entry_id","sha256"),
	CONSTRAINT "receipts_content_type_allowed" CHECK ("receipts"."content_type" in ('image/jpeg', 'image/webp', 'application/pdf')),
	CONSTRAINT "receipts_size_range" CHECK ("receipts"."size_bytes" between 1 and 10485760),
	CONSTRAINT "receipts_sha256_hex" CHECK ("receipts"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"device" text,
	"browser" text,
	"refresh_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploaded_by_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;