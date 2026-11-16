-- Custom SQL migration file, put your code below! --

-- A ballot's record (plan section 3, "Votação"): what was asked never
-- changes, and the outcome is written once. The only UPDATE that goes
-- through takes an open ballot to closed (outcome, its reason, closed_at)
-- and leaves every other column as it was. Same idea as
-- refuse_period_change() in 0011.
CREATE FUNCTION refuse_ballot_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.outcome IS NULL
    AND NEW.outcome IS NOT NULL
    AND (NEW.id, NEW.partnership_id, NEW.kind, NEW.entry_id,
         NEW.target_member_id, NEW.proposal, NEW.opened_by, NEW.reason,
         NEW.opened_at, NEW.closes_at)
      IS NOT DISTINCT FROM
        (OLD.id, OLD.partnership_id, OLD.kind, OLD.entry_id,
         OLD.target_member_id, OLD.proposal, OLD.opened_by, OLD.reason,
         OLD.opened_at, OLD.closes_at)
  THEN
    RETURN NEW;
  END IF;
  -- 23001 restrict_violation: an integrity rule, like the other constraints.
  RAISE EXCEPTION 'a ballot only closes, once: % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER ballots_close_only
  BEFORE UPDATE OR DELETE ON ballots
  FOR EACH ROW
  EXECUTE FUNCTION refuse_ballot_change();
--> statement-breakpoint

-- A row trigger doesn't fire on TRUNCATE; a statement trigger does.
CREATE TRIGGER ballots_no_truncate
  BEFORE TRUNCATE ON ballots
  FOR EACH STATEMENT
  EXECUTE FUNCTION refuse_ballot_change();
--> statement-breakpoint

-- The frozen electorate, the votes and the proposed entry are only ever
-- inserted: a vote is never changed, and nobody enters or leaves the
-- electorate after the ballot opens.
CREATE FUNCTION refuse_ballot_record_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER ballot_voters_insert_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON ballot_voters
  FOR EACH STATEMENT
  EXECUTE FUNCTION refuse_ballot_record_change();
--> statement-breakpoint

CREATE TRIGGER votes_insert_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON votes
  FOR EACH STATEMENT
  EXECUTE FUNCTION refuse_ballot_record_change();
--> statement-breakpoint

CREATE TRIGGER ballot_proposed_entries_insert_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON ballot_proposed_entries
  FOR EACH STATEMENT
  EXECUTE FUNCTION refuse_ballot_record_change();
--> statement-breakpoint

-- 0006 grants every privilege on new tables; take back what the app never
-- does. The privilege check (42501) comes before the triggers.
REVOKE DELETE ON ballots FROM partneroj_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON ballot_voters, votes, ballot_proposed_entries FROM partneroj_app;
