-- Custom SQL migration file, put your code below! --

-- A day belongs to one period of a project at most, or "the period of an
-- entry" would be ambiguous. Drizzle can't declare an EXCLUDE constraint.
-- btree_gist lets the gist index compare project_id with "="; it ships
-- with Postgres and is a trusted extension.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

ALTER TABLE periods ADD CONSTRAINT periods_no_overlap
  EXCLUDE USING gist (
    project_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  );
--> statement-breakpoint

-- A period only goes from open to closed, once (plan section 3: what a
-- closed period settled never changes). Its days never change either, or
-- an entry could move in or out of it. Same idea as refuse_entry_change()
-- in 0002, but an UPDATE that closes an open period goes through.
CREATE FUNCTION refuse_period_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.closed_at IS NULL
    AND NEW.closed_at IS NOT NULL
    AND (NEW.id, NEW.project_id, NEW.starts_on, NEW.ends_on, NEW.created_at)
      IS NOT DISTINCT FROM
      (OLD.id, OLD.project_id, OLD.starts_on, OLD.ends_on, OLD.created_at)
  THEN
    RETURN NEW;
  END IF;
  -- 23001 restrict_violation: an integrity rule, like the other constraints.
  RAISE EXCEPTION 'periods only close, once: % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER periods_close_only
  BEFORE UPDATE OR DELETE ON periods
  FOR EACH ROW
  EXECUTE FUNCTION refuse_period_change();
--> statement-breakpoint

-- A row trigger doesn't fire on TRUNCATE; a statement trigger does.
CREATE TRIGGER periods_no_truncate
  BEFORE TRUNCATE ON periods
  FOR EACH STATEMENT
  EXECUTE FUNCTION refuse_period_change();
--> statement-breakpoint

-- The app never deletes a period (0006 grants DELETE on every new table).
REVOKE DELETE ON periods FROM partneroj_app;
