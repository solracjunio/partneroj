// What the worker reads to send a push (plan section 4): what an entry
// says and whom to tell, then where each phone receives.
import { and, asc, eq, ne } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  categories,
  activities,
  entries,
  members,
  projects,
  pushSubscriptions,
  sessions,
} from "./schema.js";
import { liveSession } from "./sessions.js";

export interface EntryNotice {
  entryId: string;
  type: (typeof entries.$inferSelect)["type"];
  /** Cents; negative on a reversal (ADR 0006). */
  amount: bigint;
  category: string | null;
  description: string | null;
  authorName: string;
  /** On a reversal, the entry it undoes, and why. */
  reversalOf: string | null;
  reversalReason: string | null;
  createdAt: Date;
  /**
   * The phones to tell: every other member of the partnership, readers
   * included, on each live session. Never the author.
   */
  subscriptionIds: string[];
}

/** The notice for an entry, or null when there is no such entry. */
export async function entryNotice(
  db: Database,
  entryId: string,
): Promise<EntryNotice | null> {
  const [row] = await db
    .select({
      entryId: entries.id,
      type: entries.type,
      amount: entries.amount,
      category: categories.name,
      description: entries.description,
      authorId: entries.authorId,
      authorName: members.name,
      partnershipId: projects.partnershipId,
      reversalOf: entries.reversalOf,
      reversalReason: entries.reversalReason,
      createdAt: entries.createdAt,
    })
    .from(entries)
    .innerJoin(projects, eq(projects.id, entries.projectId))
    .innerJoin(members, eq(members.id, entries.authorId))
    .leftJoin(categories, eq(categories.id, entries.categoryId))
    .where(eq(entries.id, entryId));
  if (row === undefined) return null;

  return {
    entryId: row.entryId,
    type: row.type,
    amount: row.amount,
    category: row.category,
    description: row.description,
    authorName: row.authorName,
    reversalOf: row.reversalOf,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt,
    subscriptionIds: await subscribedPhones(
      db,
      row.partnershipId,
      row.authorId,
    ),
  };
}

/** A server action has no author to exclude from the partnership's phones. */
export async function emergencyNotice(db: Database, activityId: string) {
  const [row] = await db
    .select({
      partnershipId: activities.partnershipId,
      createdAt: activities.createdAt,
    })
    .from(activities)
    .where(
      and(
        eq(activities.id, activityId),
        eq(activities.action, "emergency_admin_created"),
      ),
    );
  if (row === undefined) return null;
  return {
    createdAt: row.createdAt,
    subscriptionIds: await subscribedPhones(db, row.partnershipId),
  };
}

async function subscribedPhones(
  db: Database,
  partnershipId: string,
  except?: string,
) {
  const phones = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .innerJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId))
    .innerJoin(members, eq(members.id, sessions.memberId))
    .where(
      and(
        eq(members.partnershipId, partnershipId),
        except === undefined ? undefined : ne(members.id, except),
        liveSession(),
      ),
    )
    .orderBy(asc(pushSubscriptions.id));
  return phones.map((p) => p.id);
}

export interface DeliveryTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Where to send, read at the moment of sending: null when the session was
 * revoked or went idle since the notice (a lost phone gets nothing more),
 * or when the subscription was removed.
 */
export async function deliveryTarget(
  db: Database,
  subscriptionId: string,
): Promise<DeliveryTarget | null> {
  const [row] = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId))
    .where(and(eq(pushSubscriptions.id, subscriptionId), liveSession()));
  return row ?? null;
}

/**
 * Removes a subscription the push service answered 404 or 410 for (plan
 * section 4). Only while it still has that endpoint: a phone that renewed
 * its subscription since keeps the new one.
 */
export async function forgetSubscription(
  db: Database,
  sent: { id: string; endpoint: string },
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.id, sent.id),
        eq(pushSubscriptions.endpoint, sent.endpoint),
      ),
    );
}
