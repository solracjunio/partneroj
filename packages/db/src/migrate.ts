import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Database } from "./client.js";

/** SQL files written by drizzle-kit, versioned in git (packages/db/drizzle). */
export const migrationsFolder = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
