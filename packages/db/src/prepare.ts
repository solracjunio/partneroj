// What each deploy does to the database, as the owner of the tables,
// before the API and the worker start (infra/production).
import pg from "pg";
import { createDatabase } from "./client.js";
import { installJobQueue } from "./jobs.js";
import { runMigrations } from "./migrate.js";

/** The user the API and the worker log in as, in the partneroj_app role. */
export const appLogin = "partneroj_api";

/**
 * Applies the migrations, creates or updates the app login, and installs
 * pg-boss. Safe to run again: on an up-to-date database it only sets the
 * login's password, so changing APP_DB_PASSWORD and deploying rotates it.
 */
export async function prepareDatabase(
  ownerConnectionString: string,
  appPassword: string,
): Promise<void> {
  if (appPassword === "") throw new Error("the app password is empty");

  const db = createDatabase(ownerConnectionString);
  try {
    await runMigrations(db);
    // DDL takes no $1 parameters, so the password is quoted by the driver.
    const password = pg.escapeLiteral(appPassword);
    await db.$client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appLogin}') THEN
          CREATE ROLE ${appLogin} LOGIN;
        END IF;
      END
      $$`);
    await db.$client.query(`ALTER ROLE ${appLogin} PASSWORD ${password}`);
    await db.$client.query(`GRANT partneroj_app TO ${appLogin}`);
  } finally {
    await db.$client.end();
  }
  await installJobQueue(ownerConnectionString);
}
