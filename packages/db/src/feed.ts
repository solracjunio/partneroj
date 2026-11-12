// The "Atividades" feed (plan section 4): a partnership's activities,
// newest first, with the entry each one is about.
import {
  aliasedTable,
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import type { Database } from "./client.js";
import {
  activities,
  activityReads,
  categories,
  entries,
  members,
  receipts,
} from "./schema.js";

export interface FeedRow {
  id: string;
  action: (typeof activities.$inferSelect)["action"];
  createdAt: Date;
  actor: { id: string; name: string };
  unread: boolean;
  entry: {
    id: string;
    type: (typeof entries.$inferSelect)["type"];
    amount: bigint;
    occurredOn: string;
    category: string | null;
    description: string | null;
    reversalOf: string | null;
    reversalReason: string | null;
    reversedBy: string | null;
    receipts: { id: string; contentType: string }[];
  } | null;
}

export interface FeedPage {
  rows: FeedRow[];
  /** The `before` of the next page, or null on the last one. */
  next: string | null;
}

/** The reversal of an entry, if any: the status is derived (ADR 0006). */
const reversal = aliasedTable(entries, "reversal");

/**
 * One page of the feed of the reader's partnership. `before` is the id of
 * the last activity of the previous page: uuidv7 ids are in time order, so
 * the id is the sort key and the cursor (activities_feed_idx), and an
 * activity added meanwhile can't push an item into the next page twice.
 *
 * The partnership is a WHERE of the query, taken from the session: an id
 * of another partnership as `before` only moves the cursor.
 */
export async function listFeed(
  db: Database,
  input: {
    partnershipId: string;
    memberId: string;
    before?: string | undefined;
    limit: number;
  },
): Promise<FeedPage> {
  const found = await db
    .select({
      id: activities.id,
      action: activities.action,
      createdAt: activities.createdAt,
      actorId: members.id,
      actorName: members.name,
      readAt: activityReads.readAt,
      entryId: entries.id,
      type: entries.type,
      amount: entries.amount,
      occurredOn: entries.occurredOn,
      category: categories.name,
      description: entries.description,
      reversalOf: entries.reversalOf,
      reversalReason: entries.reversalReason,
      reversedBy: reversal.id,
    })
    .from(activities)
    .innerJoin(members, eq(members.id, activities.actorId))
    .leftJoin(
      activityReads,
      and(
        eq(activityReads.activityId, activities.id),
        eq(activityReads.memberId, input.memberId),
      ),
    )
    .leftJoin(entries, eq(entries.id, activities.entryId))
    .leftJoin(categories, eq(categories.id, entries.categoryId))
    .leftJoin(reversal, eq(reversal.reversalOf, entries.id))
    .where(
      and(
        eq(activities.partnershipId, input.partnershipId),
        input.before === undefined
          ? undefined
          : lt(activities.id, input.before),
      ),
    )
    .orderBy(desc(activities.id))
    // One more than the page: if it comes, there is a next page.
    .limit(input.limit + 1);

  const page = found.slice(0, input.limit);
  const entryIds = page.flatMap((r) => (r.entryId ? [r.entryId] : []));
  const files =
    entryIds.length === 0
      ? []
      : await db
          .select({
            id: receipts.id,
            entryId: receipts.entryId,
            contentType: receipts.contentType,
          })
          .from(receipts)
          .where(inArray(receipts.entryId, entryIds))
          .orderBy(receipts.id);

  const rows = page.map((r): FeedRow => ({
    id: r.id,
    action: r.action,
    createdAt: r.createdAt,
    actor: { id: r.actorId, name: r.actorName },
    // One's own activity is never news to oneself.
    unread: r.readAt === null && r.actorId !== input.memberId,
    entry:
      r.entryId === null
        ? null
        : {
            id: r.entryId,
            type: r.type!,
            amount: r.amount!,
            occurredOn: r.occurredOn!,
            category: r.category,
            description: r.description,
            reversalOf: r.reversalOf,
            reversalReason: r.reversalReason,
            reversedBy: r.reversedBy,
            receipts: files
              .filter((f) => f.entryId === r.entryId)
              .map((f) => ({ id: f.id, contentType: f.contentType })),
          },
  }));
  const next = found.length > input.limit ? page.at(-1)!.id : null;
  return { rows, next };
}

/**
 * Marks activities as read by the member. Ids of another partnership are
 * skipped by the WHERE, and one already read stays as it was (ON CONFLICT
 * DO NOTHING on the (activity, member) key): opening the feed twice, or
 * a retry, changes nothing. Returns how many were newly marked.
 */
export async function markFeedRead(
  db: Database,
  input: { partnershipId: string; memberId: string; ids: string[] },
): Promise<number> {
  if (input.ids.length === 0) return 0;
  const marked = await db
    .insert(activityReads)
    .select(
      db
        .select({
          activityId: activities.id,
          memberId: sql<string>`${input.memberId}::uuid`.as("member_id"),
          readAt: sql<Date>`now()`.as("read_at"),
        })
        .from(activities)
        .where(
          and(
            inArray(activities.id, input.ids),
            eq(activities.partnershipId, input.partnershipId),
          ),
        ),
    )
    .onConflictDoNothing()
    .returning({ activityId: activityReads.activityId });
  return marked.length;
}

/**
 * How many activities of the partnership the member hasn't read, leaving
 * out their own: the number on the home screen's "Atividades" button.
 */
export async function countUnread(
  db: Database,
  input: { partnershipId: string; memberId: string },
): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(activities)
    .leftJoin(
      activityReads,
      and(
        eq(activityReads.activityId, activities.id),
        eq(activityReads.memberId, input.memberId),
      ),
    )
    .where(
      and(
        eq(activities.partnershipId, input.partnershipId),
        ne(activities.actorId, input.memberId),
        isNull(activityReads.activityId),
      ),
    );
  return row!.unread;
}
