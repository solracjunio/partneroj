-- Custom SQL migration file, put your code below! --

-- Entries are never updated or deleted: a mistake is undone by a reversal
-- (docs/adr/0006). The domain never issues UPDATE or DELETE on entries;
-- this makes the database refuse them too, from any path (API bug, script,
-- manual psql session).
--
-- The table owner can still disable the trigger. In production the app
-- connects as a user that is not the owner (infra block).
CREATE FUNCTION refuse_entry_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- 23001 restrict_violation: an integrity rule, like the other constraints.
  RAISE EXCEPTION 'entries are immutable: % refused, record a reversal instead', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER entries_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON entries
  FOR EACH STATEMENT
  EXECUTE FUNCTION refuse_entry_change();
