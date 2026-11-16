CREATE TYPE "public"."ballot_kind" AS ENUM('entry', 'member');--> statement-breakpoint
CREATE TYPE "public"."ballot_outcome" AS ENUM('approved', 'rejected', 'moot', 'no-effect');--> statement-breakpoint
CREATE TYPE "public"."ballot_proposal" AS ENUM('archive', 'correct');--> statement-breakpoint
CREATE TABLE "ballot_proposed_entries" (
	"ballot_id" uuid PRIMARY KEY NOT NULL,
	"proposal" "ballot_proposal" DEFAULT 'correct' NOT NULL,
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
	CONSTRAINT "ballot_proposed_entries_only_correct" CHECK ("ballot_proposed_entries"."proposal" = 'correct'),
	CONSTRAINT "ballot_proposed_entries_amount_positive" CHECK ("ballot_proposed_entries"."amount" > 0),
	CONSTRAINT "ballot_proposed_entries_one_party_per_side" CHECK (num_nonnulls("ballot_proposed_entries"."from_member_id", "ballot_proposed_entries"."from_account_id") <= 1
        and num_nonnulls("ballot_proposed_entries"."to_member_id", "ballot_proposed_entries"."to_account_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "ballot_voters" (
	"ballot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "ballot_voters_ballot_id_member_id_pk" PRIMARY KEY("ballot_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partnership_id" uuid NOT NULL,
	"kind" "ballot_kind" NOT NULL,
	"entry_id" uuid,
	"target_member_id" uuid,
	"proposal" "ballot_proposal",
	"opened_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"outcome" "ballot_outcome",
	"outcome_reason" text,
	"closed_at" timestamp with time zone,
	CONSTRAINT "ballots_id_proposal_unique" UNIQUE("id","proposal"),
	CONSTRAINT "ballots_reason_required" CHECK (trim("ballots"."reason") <> ''),
	CONSTRAINT "ballots_target_by_kind" CHECK (("ballots"."kind" = 'entry' and "ballots"."entry_id" is not null and "ballots"."target_member_id" is null and "ballots"."proposal" is not null)
        or ("ballots"."kind" = 'member' and "ballots"."target_member_id" is not null and "ballots"."entry_id" is null and "ballots"."proposal" is null)),
	CONSTRAINT "ballots_closes_after_opening" CHECK ("ballots"."closes_at" > "ballots"."opened_at"),
	CONSTRAINT "ballots_outcome_and_closed_at" CHECK (("ballots"."outcome" is null) = ("ballots"."closed_at" is null)),
	CONSTRAINT "ballots_outcome_reason_with_outcome" CHECK ("ballots"."outcome_reason" is null or "ballots"."outcome" is not null)
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"ballot_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"approve" boolean NOT NULL,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_ballot_id_member_id_pk" PRIMARY KEY("ballot_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "created_by_ballot_id" uuid;--> statement-breakpoint
ALTER TABLE "ballot_proposed_entries" ADD CONSTRAINT "ballot_proposed_entries_from_member_id_members_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_proposed_entries" ADD CONSTRAINT "ballot_proposed_entries_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_proposed_entries" ADD CONSTRAINT "ballot_proposed_entries_to_member_id_members_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_proposed_entries" ADD CONSTRAINT "ballot_proposed_entries_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_proposed_entries" ADD CONSTRAINT "ballot_proposed_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_proposed_entries" ADD CONSTRAINT "ballot_proposed_entries_correction_fk" FOREIGN KEY ("ballot_id","proposal") REFERENCES "public"."ballots"("id","proposal") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_voters" ADD CONSTRAINT "ballot_voters_ballot_id_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."ballots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_voters" ADD CONSTRAINT "ballot_voters_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_partnership_id_partnerships_id_fk" FOREIGN KEY ("partnership_id") REFERENCES "public"."partnerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_target_member_id_members_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_opened_by_members_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_fk" FOREIGN KEY ("ballot_id","member_id") REFERENCES "public"."ballot_voters"("ballot_id","member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_entry_once" ON "ballots" USING btree ("entry_id") WHERE "ballots"."outcome" is distinct from 'no-effect';--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_created_by_ballot_id_ballots_id_fk" FOREIGN KEY ("created_by_ballot_id") REFERENCES "public"."ballots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_ballot_source" CHECK (("entries"."source" = 'ballot') = ("entries"."created_by_ballot_id" is not null));