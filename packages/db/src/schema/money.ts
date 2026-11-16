// The partnership's money and its rules: members, projects and their
// periods, weights, accounts, categories and entries (plan section 7).
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
import { createdAt, id } from "./columns.js";

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
 * An accrual period of an ongoing project (plan section 3): once closed,
 * its entries are locked and a correction goes into a later period. A
 * construction has none; it is settled once, at the end.
 *
 * Migration 0011 adds what Drizzle can't declare: no two periods of a
 * project share a day (EXCLUDE), and a row only goes from open to closed,
 * once (trigger). The app can't delete a period.
 */
export const periods = pgTable(
  "periods",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    /** Both days included. */
    startsOn: date({ mode: "string" }).notNull(),
    endsOn: date({ mode: "string" }).notNull(),
    closedBy: uuid().references(() => members.id),
    closedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("periods_ends_after_start", sql`${t.endsOn} >= ${t.startsOn}`),
    check(
      "periods_closed_by_and_at",
      sql`(${t.closedBy} is null) = (${t.closedAt} is null)`,
    ),
  ],
);

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
    /**
     * Chosen by the phone for one draft and sent again when the save is
     * retried, so a save whose answer was lost is not recorded twice.
     */
    idempotencyKey: uuid(),
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
    // Per author: one member's key never meets another's. Entries without
    // a key (reversals, scripts) are null, and nulls never collide.
    unique("entries_author_idempotency_key_unique").on(
      t.authorId,
      t.idempotencyKey,
    ),
    check(
      "entries_reversal_reason_required",
      sql`${t.reversalOf} is null or (${t.reversalReason} is not null and trim(${t.reversalReason}) <> '')`,
    ),
  ],
);
