// Receipts (plan section 9, "Arquivos"): the row in the database, the file
// in storage. The API stores the file first, then calls addReceipt.
import { and, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditLog, entries, projects, receipts } from "./schema.js";

/**
 * The entry, when it belongs to the partnership; null otherwise. The API
 * calls it before processing an upload, so a photo for an entry of
 * another partnership is refused before anything is stored.
 */
export async function findEntryForReceipt(
  db: Database,
  input: { entryId: string; partnershipId: string },
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: entries.id })
    .from(entries)
    .innerJoin(projects, eq(projects.id, entries.projectId))
    .where(
      and(
        eq(entries.id, input.entryId),
        eq(projects.partnershipId, input.partnershipId),
      ),
    );
  return row ?? null;
}

export interface NewReceipt {
  entryId: string;
  partnershipId: string;
  uploadedBy: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  /** SHA-256 of the stored file, lowercase hex. */
  sha256: string;
}

/**
 * Records a stored file as a receipt of an entry. The same file sent
 * twice for the same entry (a retry after a dropped connection) returns
 * the receipt already recorded, with created false: the unique
 * (entry, sha256) makes the retry harmless. Null when the entry is not in
 * the partnership. Checked again here, in the transaction of the insert.
 */
export async function addReceipt(
  db: Database,
  input: NewReceipt,
): Promise<{ id: string; created: boolean } | null> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({ id: entries.id })
      .from(entries)
      .innerJoin(projects, eq(projects.id, entries.projectId))
      .where(
        and(
          eq(entries.id, input.entryId),
          eq(projects.partnershipId, input.partnershipId),
        ),
      );
    if (entry === undefined) return null;

    const [row] = await tx
      .insert(receipts)
      .values({
        entryId: entry.id,
        storageKey: input.storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        uploadedBy: input.uploadedBy,
      })
      .onConflictDoNothing({ target: [receipts.entryId, receipts.sha256] })
      .returning();
    if (row === undefined) {
      const [existing] = await tx
        .select({ id: receipts.id })
        .from(receipts)
        .where(
          and(
            eq(receipts.entryId, entry.id),
            eq(receipts.sha256, input.sha256),
          ),
        );
      return { id: existing!.id, created: false };
    }

    await tx.insert(auditLog).values({
      actorId: input.uploadedBy,
      action: "receipt.add",
      entityId: row.id,
      after: {
        entryId: row.entryId,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
      },
    });
    return { id: row.id, created: true };
  });
}

/** A receipt to download, when it belongs to the partnership; else null. */
export async function findReceipt(
  db: Database,
  input: { receiptId: string; partnershipId: string },
): Promise<{
  storageKey: string;
  contentType: string;
  sizeBytes: number;
} | null> {
  const [row] = await db
    .select({
      storageKey: receipts.storageKey,
      contentType: receipts.contentType,
      sizeBytes: receipts.sizeBytes,
    })
    .from(receipts)
    .innerJoin(entries, eq(entries.id, receipts.entryId))
    .innerJoin(projects, eq(projects.id, entries.projectId))
    .where(
      and(
        eq(receipts.id, input.receiptId),
        eq(projects.partnershipId, input.partnershipId),
      ),
    );
  return row ?? null;
}
