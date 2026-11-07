CREATE TYPE "public"."entry_source" AS ENUM('app', 'import', 'ballot', 'ai');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('expense', 'income', 'contribution', 'in-kind', 'withdrawal', 'reimbursement', 'transfer', 'opening');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_name_per_partnership_unique" UNIQUE("partnership_id","name")
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "entry_type" NOT NULL,
	"amount" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"accrual_on" date NOT NULL,
	"from_member_id" uuid,
	"from_account_id" uuid,
	"to_member_id" uuid,
	"to_account_id" uuid,
	"category_id" uuid,
	"description" text,
	"author_id" uuid NOT NULL,
	"source" "entry_source" NOT NULL,
	"reversal_of" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_reversal_of_unique" UNIQUE("reversal_of"),
	CONSTRAINT "entries_one_party_per_side" CHECK (num_nonnulls("entries"."from_member_id", "entries"."from_account_id") <= 1
        and num_nonnulls("entries"."to_member_id", "entries"."to_account_id") <= 1),
	CONSTRAINT "entries_amount_sign" CHECK (("entries"."reversal_of" is null and "entries"."amount" > 0)
        or ("entries"."reversal_of" is not null and "entries"."amount" < 0)),
	CONSTRAINT "entries_reversal_reason_required" CHECK ("entries"."reversal_of" is null or ("entries"."reversal_reason" is not null and trim("entries"."reversal_reason") <> ''))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_from_member_id_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_to_member_id_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_reversal_of_entries_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;