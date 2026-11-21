// Getting in and being told: invites, device sessions, passkeys and push
// subscriptions (plan section 6).
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgEnum,
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

/** Only the URL-safe base64 alphabet, without padding (RFC 4648, section 5). */
const base64url = (column: unknown) => sql`${column} ~ '^[A-Za-z0-9_-]+$'`;

/**
 * A member's passkey (plan section 6, "Passkey"). Discoverable: at sign-in
 * the phone sends credentialId, and the server finds the member by it.
 * The public key only checks signatures, so a copy of the database can't
 * be used to enter. Revoked with the member's sessions after a lost phone,
 * never deleted (migration 0017).
 */
export const credentials = pgTable(
  "credentials",
  {
    id: id(),
    memberId: uuid()
      .notNull()
      .references(() => members.id),
    /** The id the phone made for this passkey, base64url. */
    credentialId: text().notNull(),
    /** COSE public key, base64url. */
    publicKey: text().notNull(),
    /**
     * Signature counter (WebAuthn, section 6.1.1): a 32-bit unsigned
     * number, beyond integer. Passkeys synced by a password manager
     * always send 0.
     */
    counter: bigint({ mode: "number" }).notNull().default(0),
    /** Hints for the browser, such as "internal" or "hybrid". */
    transports: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("credentials_credential_id_unique").on(t.credentialId),
    check("credentials_credential_id_base64url", base64url(t.credentialId)),
    check("credentials_public_key_base64url", base64url(t.publicKey)),
    check(
      "credentials_counter_unsigned_32_bit",
      sql`${t.counter} between 0 and 4294967295`,
    ),
  ],
);

export const webauthnPurpose = pgEnum("webauthn_purpose", [
  "register",
  "login",
]);

/**
 * A WebAuthn challenge, used once and within minutes. As with invites,
 * only its SHA-256 is stored; the signed answer carries the challenge
 * back, so the row is found by its hash. A challenge to register a
 * passkey belongs to the session that asked for it; one to sign in
 * belongs to nobody yet.
 */
export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: id(),
    challengeHash: text().notNull(),
    purpose: webauthnPurpose().notNull(),
    sessionId: uuid().references(() => sessions.id),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("webauthn_challenges_challenge_hash_unique").on(t.challengeHash),
    check(
      "webauthn_challenges_session_by_purpose",
      sql`(${t.purpose} = 'register') = (${t.sessionId} is not null)`,
    ),
    check(
      "webauthn_challenges_expire_after_creation",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
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
