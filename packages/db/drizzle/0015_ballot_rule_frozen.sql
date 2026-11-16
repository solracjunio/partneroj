-- Custom SQL migration file, put your code below! --
-- The rule a ballot is decided by joins what never changes (0013): it is
-- copied from the partnership when the ballot opens, like the frozen
-- electorate. The triggers of 0013 keep calling this function.
CREATE OR REPLACE FUNCTION refuse_ballot_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.outcome IS NULL
    AND NEW.outcome IS NOT NULL
    AND (NEW.id, NEW.partnership_id, NEW.kind, NEW.entry_id,
         NEW.target_member_id, NEW.proposal, NEW.rule, NEW.opened_by, NEW.reason,
         NEW.opened_at, NEW.closes_at)
      IS NOT DISTINCT FROM
        (OLD.id, OLD.partnership_id, OLD.kind, OLD.entry_id,
         OLD.target_member_id, OLD.proposal, OLD.rule, OLD.opened_by, OLD.reason,
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
