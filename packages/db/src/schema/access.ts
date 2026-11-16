// Getting in and being told: invites, device sessions and push
// subscriptions (plan section 6).
import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.js";
import { members } from "./money.js";

/**
 * A one-time link for a member to enter (plan section 6, "Convite").
 * Only the SHA-256 of the token is stored: a copy of the database can't
 * be used to enter. Opening the link does not use it; a POST does.
 */
export const invites = pgTable(
  "invites",
  {
    id: id(),
    memberId: uuid()
      .notNull()
      .references(() => members.id),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    /**
     * Null for an invite made by a command on the server: the first ones,
     * before anybody has a session, and the emergency procedure.
     */
    createdBy: uuid().references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("invites_token_hash_unique").on(t.tokenHash),
    check(
      "invites_expire_after_creation",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
);

/**
 * A long-lived device session, renewed on each use (plan section 6).
 * As with invites, only the hash of the refresh token is stored.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    memberId: uuid()
      .notNull()
      .references(() => members.id),
    device: text(),
    browser: text(),
    refreshTokenHash: text().notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [unique("sessions_refresh_token_hash_unique").on(t.refreshTokenHash)],
);

/**
 * A phone's Web Push subscription (plan section 4), at most one per
 * session: the member comes from the session, and revoking the session
 * stops the notifications to that phone. The endpoint is unique too: it
 * names one browser, so when it signs in again the subscription moves to
 * the new session instead of being kept twice.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id),
    /** The push service's URL for this browser (an https capability URL). */
    endpoint: text().notNull(),
    /** The browser's public key and secret, base64url (RFC 8291). */
    p256dh: text().notNull(),
    auth: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("push_subscriptions_session_id_unique").on(t.sessionId),
    unique("push_subscriptions_endpoint_unique").on(t.endpoint),
  ],
);
