// What happened: the activity feed and the audit log.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.js";
import { entries, members, partnerships } from "./money.js";

export const activityAction = pgEnum("activity_action", [
  "entry_recorded",
  "entry_reversed",
  "member_joined",
]);

/**
 * The in-app feed (plan section 8), the source of truth for "what
 * happened": if a push notification is lost, the activity is still here.
 * Written in the same transaction as what it reports.
 */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    partnershipId: uuid()
      .notNull()
      .references(() => partnerships.id),
    actorId: uuid()
      .notNull()
      .references(() => members.id),
    action: activityAction().notNull(),
    entryId: uuid().references(() => entries.id),
    createdAt: createdAt(),
  },
  (t) => [
    // The feed reads one partnership, newest first; uuidv7 ids are in time
    // order, so the id doubles as the sort key.
    index("activities_feed_idx").on(t.partnershipId, t.id.desc()),
    check(
      "activities_entry_reference",
      sql`(${t.action} = 'member_joined') = (${t.entryId} is null)`,
    ),
  ],
);

/** Who has seen which activity: the "unread" mark of the feed. */
export const activityReads = pgTable(
  "activity_reads",
  {
    activityId: uuid()
      .notNull()
      .references(() => activities.id),
    memberId: uuid()
      .notNull()
      .references(() => members.id),
    readAt: createdAt(),
  },
  // One read per member and activity; the pair is the row's identity.
  (t) => [primaryKey({ columns: [t.activityId, t.memberId] })],
);

/**
 * Minimal audit (plan section 6): who did what, with the row before and
 * after, in the same transaction as the change. Insert-only, enforced by a
 * trigger (migration 0005).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    /** Null for a command run on the server (emergency procedure). */
    actorId: uuid().references(() => members.id),
    /** What happened, as entity.verb: "entry.record", "session.revoke". */
    action: text().notNull(),
    entityId: uuid().notNull(),
    before: jsonb(),
    after: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityId),
    check(
      "audit_log_action_format",
      sql`${t.action} ~ '^[a-z]+(_[a-z]+)*\\.[a-z]+(_[a-z]+)*$'`,
    ),
  ],
);
