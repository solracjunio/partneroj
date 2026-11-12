// The "Lançamento" screen (plan section 5): one entry of the reader's
// partnership, with its receipts, who paid and its derived status.
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { categories, entries, members, projects, receipts } from "./schema.js";

export interface EntryDetailsRow {
  id: string;
  type: (typeof entries.$inferSelect)["type"];
  amount: bigint;
  occurredOn: string;
  category: string | null;
  description: string | null;
  paidBy: { id: string; name: string } | null;
  author: { id: string; name: string };
  createdAt: Date;
  receipts: { id: string; contentType: string }[];
  /** The reversal of this entry, if it was undone. */
  reversal: {
    id: string;
    reason: string;
    createdAt: Date;
    by: { id: string; name: string };
  } | null;
  reversalOf: string | null;
  /**
   * Whether the reader may undo it: their own entry, not a reversal and
   * not undone yet. The same checks reverseEntry makes (ADR 0006), so the
   * button only shows when the request would pass; the domain still
   * decides, and refuses an account left below zero.
   */
  canReverse: boolean;
}

/**
 * The entry, when it belongs to the reader's partnership; null otherwise.
 * The partnership is a WHERE of the query, as everywhere: another
 * partnership's id is "not found", never "forbidden".
 */
export async function findEntryDetails(
  db: Database,
  input: { entryId: string; partnershipId: string; memberId: string },
): Promise<EntryDetailsRow | null> {
  const [row] = await db
    .select({
      id: entries.id,
      type: entries.type,
      amount: entries.amount,
      occurredOn: entries.occurredOn,
      description: entries.description,
      authorId: entries.authorId,
      createdAt: entries.createdAt,
      reversalOf: entries.reversalOf,
      category: categories.name,
      fromMemberId: entries.fromMemberId,
    })
    .from(entries)
    .innerJoin(projects, eq(projects.id, entries.projectId))
    .leftJoin(categories, eq(categories.id, entries.categoryId))
    .where(
      and(
        eq(entries.id, input.entryId),
        eq(projects.partnershipId, input.partnershipId),
      ),
    );
  if (row === undefined) return null;

  // Names apart: Drizzle's types can't take the same table twice in one
  // query (author and payer are both members).
  const names = new Map(
    (
      await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(
          and(
            inArray(
              members.id,
              [row.authorId, row.fromMemberId].filter((id) => id !== null),
            ),
            eq(members.partnershipId, input.partnershipId),
          ),
        )
    ).map((m) => [m.id, m.name]),
  );
  const named = (id: string) => ({ id, name: names.get(id)! });

  const files = await db
    .select({ id: receipts.id, contentType: receipts.contentType })
    .from(receipts)
    .where(eq(receipts.entryId, row.id))
    .orderBy(receipts.id);

  // The reversal of this entry, if any: the status is derived (ADR 0006).
  const [undone] = await db
    .select({
      id: entries.id,
      reason: entries.reversalReason,
      createdAt: entries.createdAt,
      byId: members.id,
      byName: members.name,
    })
    .from(entries)
    .innerJoin(members, eq(members.id, entries.authorId))
    .where(eq(entries.reversalOf, row.id));

  const e = row;
  return {
    id: e.id,
    type: e.type,
    amount: e.amount,
    occurredOn: e.occurredOn,
    category: row.category,
    description: e.description,
    paidBy: e.fromMemberId === null ? null : named(e.fromMemberId),
    author: named(e.authorId),
    createdAt: e.createdAt,
    receipts: files,
    reversal:
      undone === undefined
        ? null
        : {
            id: undone.id,
            reason: undone.reason!,
            createdAt: undone.createdAt,
            by: { id: undone.byId, name: undone.byName },
          },
    reversalOf: e.reversalOf,
    canReverse:
      e.authorId === input.memberId &&
      e.reversalOf === null &&
      undone === undefined,
  };
}
