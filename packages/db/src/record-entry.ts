// Recording an entry (plan section 8): the entry, its feed row, its audit
// row and the job that sends the push are written in one transaction, so
// either all four exist or none does.
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Database } from "./client.js";
import { queueEntryNotification } from "./jobs.js";
import { activities, auditLog, entries, projects } from "./schema.js";

export type NewEntry = typeof entries.$inferInsert;
export type Entry = typeof entries.$inferSelect;

/**
 * A row as JSON for the audit log. JSON has no bigint (JSON.stringify
 * throws on one), so amounts in cents become strings: "15000".
 */
export function auditJson(row: object): unknown {
  return JSON.parse(
    JSON.stringify(row, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

/** Records an entry or a reversal with its feed row, audit and push job. */
export async function recordEntry(
  db: Database,
  boss: PgBoss,
  entry: NewEntry,
): Promise<Entry> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(entries).values(entry).returning();
    const [project] = await tx
      .select({ partnershipId: projects.partnershipId })
      .from(projects)
      .where(eq(projects.id, row!.projectId));

    await tx.insert(activities).values({
      partnershipId: project!.partnershipId,
      actorId: row!.authorId,
      action: row!.reversalOf ? "entry_reversed" : "entry_recorded",
      entryId: row!.id,
    });

    await tx.insert(auditLog).values({
      actorId: row!.authorId,
      action: row!.reversalOf ? "entry.reverse" : "entry.record",
      entityId: row!.id,
      after: auditJson(row!),
    });

    await queueEntryNotification(boss, tx, row!.id);
    return row!;
  });
}
