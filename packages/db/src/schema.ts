// Database schema (plan section 7). Column names are camelCase here and
// snake_case in Postgres (casing option in drizzle.config.ts and client.ts).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// uuidv7() is built into Postgres 18: time-ordered ids keep new rows at the
// end of the primary key index instead of scattered like random v4 ids.
const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();

export const partnerships = pgTable("partnerships", {
  id: id(),
  name: text().notNull(),
  /** Brazilian company id (CNPJ), when there is a company. */
  taxId: text(),
  createdAt: createdAt(),
});

export const memberRole = pgEnum("member_role", ["admin", "partner", "reader"]);

export const members = pgTable("members", {
  id: id(),
  partnershipId: uuid()
    .notNull()
    .references(() => partnerships.id),
  name: text().notNull(),
  role: memberRole().notNull(),
  pixKey: text(),
  createdAt: createdAt(),
});

export const projectKind = pgEnum("project_kind", ["construction", "ongoing"]);

export const projects = pgTable("projects", {
  id: id(),
  partnershipId: uuid()
    .notNull()
    .references(() => partnerships.id),
  name: text().notNull(),
  kind: projectKind().notNull(),
  startsOn: date({ mode: "string" }).notNull(),
  endsOn: date({ mode: "string" }),
  /** Set once, 7 days before the final settlement (plan section 3). */
  settlementAnnouncedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * A member's weight in a project (docs/adr/0002). Fixed for the whole
 * project. drawPosition is the order drawn once when the project is
 * created; the domain takes them sorted by it to break ties.
 */
export const weights = pgTable(
  "weights",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    memberId: uuid()
      .notNull()
      .references(() => members.id),
    weight: integer().notNull(),
    drawPosition: integer().notNull(),
  },
  (t) => [
    check("weights_weight_positive", sql`${t.weight} >= 1`),
    unique("weights_member_per_project_unique").on(t.projectId, t.memberId),
    unique("weights_draw_position_per_project_unique").on(
      t.projectId,
      t.drawPosition,
    ),
  ],
);

/**
 * A bank account or cash box of the partnership. There is no balance
 * column: the balance is always derived from entries, so an account
 * always starts at zero and money in it always has an owner (ADR 0007).
 */
export const accounts = pgTable("accounts", {
  id: id(),
  partnershipId: uuid()
    .notNull()
    .references(() => partnerships.id),
  name: text().notNull(),
  createdAt: createdAt(),
});

export const categories = pgTable(
  "categories",
  {
    id: id(),
    partnershipId: uuid()
      .notNull()
      .references(() => partnerships.id),
    name: text().notNull(),
  },
  (t) => [
    unique("categories_name_per_partnership_unique").on(
      t.partnershipId,
      t.name,
    ),
  ],
);

/** Same names as Entry["type"] in packages/domain. */
export const entryType = pgEnum("entry_type", [
  "expense",
  "income",
  "contribution",
  "in-kind",
  "withdrawal",
  "reimbursement",
  "transfer",
  "opening",
]);

export const entrySource = pgEnum("entry_source", [
  "app",
  "import",
  "ballot",
  "ai",
]);

/**
 * A money flow (plan section 3). Never updated or deleted: a mistake is
 * undone by a reversal, a new row with the sign inverted (ADR 0006).
 * There is no status column; the status is derived from reversals and
 * open ballots.
 *
 * Each side is a member's pocket, an account, or nobody (money from or to
 * outside, like an expense or an income). Which sides each type needs is
 * checked by the domain before the insert.
 */
export const entries = pgTable(
  "entries",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    type: entryType().notNull(),
    /** Cents (ADR 0005). Positive on an entry, negative on its reversal. */
    amount: bigint({ mode: "bigint" }).notNull(),
    /** When the money moved. */
    occurredOn: date({ mode: "string" }).notNull(),
    /** Which period it belongs to, by accrual (plan section 3). */
    accrualOn: date({ mode: "string" }).notNull(),
    fromMemberId: uuid().references(() => members.id),
    fromAccountId: uuid().references(() => accounts.id),
    toMemberId: uuid().references(() => members.id),
    toAccountId: uuid().references(() => accounts.id),
    categoryId: uuid().references(() => categories.id),
    description: text(),
    authorId: uuid()
      .notNull()
      .references(() => members.id),
    source: entrySource().notNull(),
    reversalOf: uuid().references((): AnyPgColumn => entries.id),
    reversalReason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "entries_one_party_per_side",
      sql`num_nonnulls(${t.fromMemberId}, ${t.fromAccountId}) <= 1
        and num_nonnulls(${t.toMemberId}, ${t.toAccountId}) <= 1`,
    ),
    check(
      "entries_amount_sign",
      sql`(${t.reversalOf} is null and ${t.amount} > 0)
        or (${t.reversalOf} is not null and ${t.amount} < 0)`,
    ),
    unique("entries_reversal_of_unique").on(t.reversalOf),
    check(
      "entries_reversal_reason_required",
      sql`${t.reversalOf} is null or (${t.reversalReason} is not null and trim(${t.reversalReason}) <> '')`,
    ),
  ],
);

/** Kinds of file a receipt can be: photos are re-encoded without EXIF. */
export const receiptContentTypes = [
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

/**
 * A photo or PDF of a receipt (plan section 9, "Arquivos"). The file
 * itself lives in storage under storageKey; the hash finds the same file
 * sent twice and proves the file was not changed afterwards.
 */
export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    entryId: uuid()
      .notNull()
      .references(() => entries.id),
    storageKey: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    /** SHA-256 of the stored file, in lowercase hex. */
    sha256: text().notNull(),
    uploadedBy: uuid()
      .notNull()
      .references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("receipts_storage_key_unique").on(t.storageKey),
    unique("receipts_file_per_entry_unique").on(t.entryId, t.sha256),
    check(
      "receipts_content_type_allowed",
      sql`${t.contentType} in (${sql.raw(
        receiptContentTypes.map((type) => `'${type}'`).join(", "),
      )})`,
    ),
    // Photos are resized before upload; 10 MB is far above a real one.
    check("receipts_size_range", sql`${t.sizeBytes} between 1 and 10485760`),
    check("receipts_sha256_hex", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

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
    createdBy: uuid()
      .notNull()
      .references(() => members.id),
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
