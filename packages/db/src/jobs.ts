// Jobs on pg-boss, in the same Postgres as the data (plan section 4).
// The queue lives next to the entries, so an entry and the job that
// announces it are written in one transaction: both or neither.
import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import type { Database } from "./client.js";

export const queues = {
  /** Sends a push notification about a new entry to the other partners. */
  entryNotification: "entry-notification",
} as const;

export interface EntryNotification {
  entryId: string;
}

/** The `tx` that db.transaction() hands to its callback. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Starts pg-boss (creating its schema on the first run) and its queues. */
export async function startJobQueue(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString });
  // An EventEmitter without an "error" listener crashes the process.
  boss.on("error", (error) => console.error("pg-boss", error));
  await boss.start();
  for (const name of Object.values(queues)) await boss.createQueue(name);
  return boss;
}

/**
 * Queues the notification of an entry inside the caller's transaction: if
 * the transaction rolls back, the job is gone too, so no partner is told
 * about an entry that was never recorded.
 */
export async function queueEntryNotification(
  boss: PgBoss,
  tx: Transaction,
  entryId: string,
): Promise<void> {
  const data: EntryNotification = { entryId };
  await boss.send(queues.entryNotification, data, { db: fromDrizzle(tx, sql) });
}
