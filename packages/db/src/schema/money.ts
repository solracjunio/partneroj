// The partnership's money and its rules: members, projects and their
// periods, weights, accounts, categories, entries and the ballots that
// contest them (plan section 7).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.js";

/** Same names as BallotRule in packages/domain. */
export const ballotRule = pgEnum("ballot_rule", ["majority", "unanimity"]);

export const partnerships = pgTable("partnerships", {
  id: id(),
  name: text().notNull(),
  /** Brazilian company id (CNPJ), when there is a company. */
  taxId: text(),
  /**
   * How a ballot on an entry is decided (ADR 0004): majority for a new
   * partnership, unless whoever creates it says otherwise. Changed only
   * by a server command (admin-cli set-ballot-rule), audited.
   */
  entryBallotRule: ballotRule().notNull().default("majority"),
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
 * The name of an account or category, as it shows on a button: no space
 * at either end, and from 1 to 60 characters (not bytes).
 */
const buttonName = (name: AnyPgColumn) =>
  sql`${name} = btrim(${name}) AND char_length(${name}) BETWEEN 1 AND 60`;

/**
 * When an account or category left the buttons. Entries point at it and
 * never change, so it is archived instead of deleted (migration 0016),
 * and archiving it again later is the same as restoring it first.
 */
const archivedAt = () => timestamp({ withTimezone: true });

/**
 * A bank account or cash box of the partnership. There is no balance
 * column: the balance is always derived from entries, so an account
 * always starts at zero and money in it always has an owner (ADR 0007).
 */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    partnershipId: uuid()
      .notNull()
      .references(() => partnerships.id),
    name: text().notNull(),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  (t) => [
    unique("accounts_name_per_partnership_unique").on(t.partnershipId, t.name),
    check("accounts_name_shape", buttonName(t.name)),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    partnershipId: uuid()
      .notNull()
      .references(() => partnerships.id),
    name: text().notNull(),
    archivedAt: archivedAt(),
  },
  (t) => [
    unique("categories_name_per_partnership_unique").on(
      t.partnershipId,
      t.name,
    ),
    check("categories_name_shape", buttonName(t.name)),
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
     * The ballot that created it: the corrected entry, or the reversal an
     * approved ballot recorded. Such an entry can't be reversed or
     * contested (plan section 3).
     */
    createdByBallotId: uuid().references((): AnyPgColumn => ballots.id),
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
      "entries_ballot_source",
      sql`(${t.source} = 'ballot') = (${t.createdByBallotId} is not null)`,
    ),
    check(
      "entries_reversal_reason_required",
      sql`${t.reversalOf} is null or (${t.reversalReason} is not null and trim(${t.reversalReason}) <> '')`,
    ),
  ],
);

export const ballotKind = pgEnum("ballot_kind", ["entry", "member"]);

/** Same names as Proposal["kind"] in packages/domain. */
export const ballotProposal = pgEnum("ballot_proposal", ["archive", "correct"]);

/** Same names as Outcome in packages/domain. */
export const ballotOutcome = pgEnum("ballot_outcome", [
  "approved",
  "rejected",
  "moot",
  "no-effect",
]);

/**
 * A ballot (plan section 3, "Votação"), on an entry or on a member. The
 * domain counts it (tallyBallot); this records what was asked, and the
 * outcome once. Migration 0013 adds the trigger: a row only goes from open
 * to closed, once, and nothing else in it ever changes. The app can't
 * delete one.
 *
 * What a ballot on a member proposes comes with those ballots (block 4).
 */
export const ballots = pgTable(
  "ballots",
  {
    id: id(),
    partnershipId: uuid()
      .notNull()
      .references(() => partnerships.id),
    kind: ballotKind().notNull(),
    entryId: uuid().references(() => entries.id),
    targetMemberId: uuid().references(() => members.id),
    proposal: ballotProposal(),
    /**
     * Copied from the partnership when it opens, and frozen like the
     * electorate: changing the partnership's rule doesn't change an open
     * ballot. A ballot on a member is always by majority (ADR 0004).
     */
    rule: ballotRule().notNull(),
    openedBy: uuid()
      .notNull()
      .references(() => members.id),
    reason: text().notNull(),
    openedAt: createdAt(),
    /** 7 days after it opened (closesAt in packages/domain). */
    closesAt: timestamp({ withTimezone: true }).notNull(),
    outcome: ballotOutcome(),
    /** Why it had no effect, for example the account it would overdraw. */
    outcomeReason: text(),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("ballots_reason_required", sql`trim(${t.reason}) <> ''`),
    check(
      "ballots_target_by_kind",
      sql`(${t.kind} = 'entry' and ${t.entryId} is not null and ${t.targetMemberId} is null and ${t.proposal} is not null)
        or (${t.kind} = 'member' and ${t.targetMemberId} is not null and ${t.entryId} is null and ${t.proposal} is null)`,
    ),
    check(
      "ballots_member_by_majority",
      sql`${t.kind} = 'entry' or ${t.rule} = 'majority'`,
    ),
    check("ballots_closes_after_opening", sql`${t.closesAt} > ${t.openedAt}`),
    check(
      "ballots_outcome_and_closed_at",
      sql`(${t.outcome} is null) = (${t.closedAt} is null)`,
    ),
    check(
      "ballots_outcome_reason_with_outcome",
      sql`${t.outcomeReason} is null or ${t.outcome} is not null`,
    ),
    // One open or decided ballot per entry; only "no-effect" frees it,
    // since the majority won and only the balance stopped it. An open
    // ballot has a null outcome, which is distinct from 'no-effect'.
    uniqueIndex("ballots_entry_once")
      .on(t.entryId)
      .where(sql`${t.outcome} is distinct from 'no-effect'`),
    // For ballot_proposed_entries to reference only a correction.
    unique("ballots_id_proposal_unique").on(t.id, t.proposal),
  ],
);

/**
 * The entry a correction proposes, recorded in the original author's name
 * when the ballot is approved. Same sides and checks as entries. Only a
 * "correct" ballot can have one: the foreign key goes through
 * (ballot_id, proposal), and proposal here can only be 'correct'.
 * Insert-only (migration 0013).
 */
export const ballotProposedEntries = pgTable(
  "ballot_proposed_entries",
  {
    ballotId: uuid().primaryKey(),
    proposal: ballotProposal().notNull().default("correct"),
    type: entryType().notNull(),
    /** Cents (ADR 0005). */
    amount: bigint({ mode: "bigint" }).notNull(),
    occurredOn: date({ mode: "string" }).notNull(),
    accrualOn: date({ mode: "string" }).notNull(),
    fromMemberId: uuid().references(() => members.id),
    fromAccountId: uuid().references(() => accounts.id),
    toMemberId: uuid().references(() => members.id),
    toAccountId: uuid().references(() => accounts.id),
    categoryId: uuid().references(() => categories.id),
    description: text(),
  },
  (t) => [
    foreignKey({
      name: "ballot_proposed_entries_correction_fk",
      columns: [t.ballotId, t.proposal],
      foreignColumns: [ballots.id, ballots.proposal],
    }),
    check(
      "ballot_proposed_entries_only_correct",
      sql`${t.proposal} = 'correct'`,
    ),
    check("ballot_proposed_entries_amount_positive", sql`${t.amount} > 0`),
    check(
      "ballot_proposed_entries_one_party_per_side",
      sql`num_nonnulls(${t.fromMemberId}, ${t.fromAccountId}) <= 1
        and num_nonnulls(${t.toMemberId}, ${t.toAccountId}) <= 1`,
    ),
  ],
);

/**
 * Who may vote: frozen when the ballot opens (plan section 3). Members
 * who join, leave or change role later don't change it. Insert-only
 * (migration 0013).
 */
export const ballotVoters = pgTable(
  "ballot_voters",
  {
    ballotId: uuid()
      .notNull()
      .references(() => ballots.id),
    memberId: uuid()
      .notNull()
      .references(() => members.id),
  },
  (t) => [primaryKey({ columns: [t.ballotId, t.memberId] })],
);

/**
 * One vote per voter, yes or no, never changed. The foreign key to
 * ballot_voters keeps out anyone outside the frozen electorate.
 * Insert-only (migration 0013).
 */
export const votes = pgTable(
  "votes",
  {
    ballotId: uuid().notNull(),
    memberId: uuid().notNull(),
    approve: boolean().notNull(),
    castAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ballotId, t.memberId] }),
    foreignKey({
      name: "votes_voter_fk",
      columns: [t.ballotId, t.memberId],
      foreignColumns: [ballotVoters.ballotId, ballotVoters.memberId],
    }),
  ],
);
