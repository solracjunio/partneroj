CREATE TYPE "public"."ballot_rule" AS ENUM('majority', 'unanimity');--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "rule" "ballot_rule" NOT NULL;--> statement-breakpoint
ALTER TABLE "partnerships" ADD COLUMN "entry_ballot_rule" "ballot_rule" DEFAULT 'majority' NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_member_by_majority" CHECK ("ballots"."kind" = 'entry' or "ballots"."rule" = 'majority');