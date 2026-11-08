-- Custom SQL migration file, put your code below! --

-- The role the app runs as (plan section 6, infra block). It is not the
-- owner of the tables: only the owner can drop or disable the triggers of
-- 0002 and 0005, so the app cannot switch them off, by bug or by intrusion.
--
-- NOLOGIN: this is a group of privileges, with no password. The deploy
-- creates the login user and grants it this role, so no secret is in git:
--   CREATE ROLE partneroj_api LOGIN PASSWORD '...' IN ROLE partneroj_app;
-- Migrations keep running as the owner.
--
-- Roles belong to the whole Postgres cluster, not to one database, so the
-- role may already exist (another database on the same server).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'partneroj_app') THEN
    CREATE ROLE partneroj_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO partneroj_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO partneroj_app;
--> statement-breakpoint

-- Insert-only tables: the privilege check fails (42501) before the trigger
-- runs; the trigger (23001) still holds for anyone who has the privilege.
-- TRUNCATE was never granted.
REVOKE UPDATE, DELETE ON entries, audit_log FROM partneroj_app;
--> statement-breakpoint

-- Tables created by later migrations get the same grants. This applies to
-- tables created by the role running this statement, which is the role
-- that runs every migration. A new insert-only table revokes on its own.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO partneroj_app;

-- pg-boss gets its own schema, owned by this role: see installJobQueue()
-- in src/jobs.ts.
