-- Custom SQL migration file, put your code below! --

-- The audit log only grows (plan section 6): a row that could be changed
-- or removed would prove nothing. Same guard as entries (0002).
--
-- The plan also takes UPDATE and DELETE away from the app's database user
-- (infra block); this trigger already holds in tests and for any path.
-- A superuser can still get around both, which the plan states openly.
CREATE FUNCTION refuse_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the audit log is insert-only: % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_log_insert_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION refuse_audit_change();