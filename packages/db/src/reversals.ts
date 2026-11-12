// "Desfazer" (plan section 5, ADR 0006): an entry is never changed; it is
// undone by a reversal, a new entry with the sign inverted. The rules are
// the domain's (createReversal); this file loads what they need and writes
// the result in the same transaction.
import {
  createReversal,
  DomainError,
  type DomainErrorCode,
  type Entry as DomainEntry,
  type LedgerEntry,
} from "@partneroj/domain";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import { recordEntryIn, type Entry } from "./record-entry.js";
import { entries, projects, weights } from "./schema.js";

/** Why a reversal was refused; the API turns each into a response. */
export type ReversalRefusal = DomainErrorCode | "not-author";

export class ReversalRefused extends Error {
  constructor(readonly reason: ReversalRefusal) {
    super(reason);
    this.name = "ReversalRefused";
  }
}

/** The longest reason, the same as an expense's description. */
export const MAX_REASON_LENGTH = 200;

/**
 * A row as the domain sees it. Which sides each type has is the domain's
 * rule, checked when the entry was recorded: a row without them is a bug,
 * not a refusal.
 */
function toLedgerEntry(row: Entry): LedgerEntry {
  const side = (member: string | null, account: string | null) => {
    if (member !== null) return { partner: member };
    if (account !== null) return { account };
    throw new Error(`entry ${row.id} has no party on a side it needs`);
  };
  const need = (value: string | null) => {
    if (value === null) throw new Error(`entry ${row.id} misses a party`);
    return value;
  };
  const amount = row.amount;
  let entry: DomainEntry;
  switch (row.type) {
    case "expense":
      entry = {
        type: "expense",
        amount,
        from: side(row.fromMemberId, row.fromAccountId),
      };
      break;
    case "income":
      entry = {
        type: "income",
        amount,
        to: side(row.toMemberId, row.toAccountId),
      };
      break;
    case "in-kind":
      entry = { type: "in-kind", amount, partner: need(row.fromMemberId) };
      break;
    case "contribution":
    case "opening":
      entry = {
        type: row.type,
        amount,
        partner: need(row.fromMemberId),
        account: need(row.toAccountId),
      };
      break;
    case "withdrawal":
    case "reimbursement":
      entry = {
        type: row.type,
        amount,
        account: need(row.fromAccountId),
        partner: need(row.toMemberId),
      };
      break;
    case "transfer":
      entry = {
        type: "transfer",
        amount,
        fromAccount: need(row.fromAccountId),
        toAccount: need(row.toAccountId),
      };
      break;
  }
  return {
    ...entry,
    id: row.id,
    ...(row.reversalOf === null ? {} : { reversalOf: row.reversalOf }),
    ...(row.reversalReason === null ? {} : { reason: row.reversalReason }),
  };
}

/** Postgres' unique_violation: here, entries_reversal_of_unique. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { cause?: { code?: string } }).cause?.code === "23505";
}

/**
 * Undoes an entry of the actor's partnership, with its feed row, audit and
 * push job (recordEntryIn). Only the author may undo their own entry (ADR
 * 0006); the others will contest through a vote.
 *
 * The domain refuses a missing reason, a second reversal, a reversal of a
 * reversal and an account left below zero. Two requests at the same
 * moment can both pass that check; the unique index on reversal_of lets
 * only one insert, and the other is refused as already reversed.
 */
export async function reverseEntry(
  db: Database,
  boss: PgBoss,
  actor: { memberId: string; partnershipId: string },
  request: { entryId: string; reason: string },
): Promise<Entry> {
  try {
    return await db.transaction((tx) => reverseIn(tx, boss, actor, request));
  } catch (error) {
    if (isUniqueViolation(error)) throw new ReversalRefused("already-reversed");
    if (error instanceof DomainError) throw new ReversalRefused(error.code);
    throw error;
  }
}

async function reverseIn(
  tx: Transaction,
  boss: PgBoss,
  actor: { memberId: string; partnershipId: string },
  request: { entryId: string; reason: string },
): Promise<Entry> {
  const [found] = await tx
    .select({ entry: entries })
    .from(entries)
    .innerJoin(projects, eq(projects.id, entries.projectId))
    .where(
      and(
        eq(entries.id, request.entryId),
        eq(projects.partnershipId, actor.partnershipId),
      ),
    );
  // Another partnership's entry looks the same as one that doesn't exist.
  if (found === undefined) throw new ReversalRefused("entry-not-found");
  const original = found.entry;
  if (original.authorId !== actor.memberId) {
    throw new ReversalRefused("not-author");
  }
  if (request.reason.trim().length > MAX_REASON_LENGTH) {
    throw new RangeError("reason too long");
  }

  // The project's whole ledger: the domain looks for an earlier reversal
  // and simulates the balances with this one. The partners' version has
  // one project and no shared account, so the project is all it needs.
  const ledger = await tx
    .select()
    .from(entries)
    .where(eq(entries.projectId, original.projectId))
    .orderBy(entries.id);
  const projectWeights = await tx
    .select({ partnerId: weights.memberId, weight: weights.weight })
    .from(weights)
    .where(eq(weights.projectId, original.projectId));

  const reversal = createReversal(ledger.map(toLedgerEntry), projectWeights, {
    // The database gives the real id (uuidv7); the domain only needs one
    // that no entry has.
    id: "new",
    originalId: original.id,
    reason: request.reason,
  });

  return recordEntryIn(tx, boss, {
    projectId: original.projectId,
    type: original.type,
    amount: reversal.amount,
    // The same dates as the original: the reversal cancels it in the same
    // period and on the same day of the reports.
    occurredOn: original.occurredOn,
    accrualOn: original.accrualOn,
    fromMemberId: original.fromMemberId,
    fromAccountId: original.fromAccountId,
    toMemberId: original.toMemberId,
    toAccountId: original.toAccountId,
    categoryId: original.categoryId,
    description: original.description,
    authorId: actor.memberId,
    source: "app",
    reversalOf: original.id,
    reversalReason: reversal.reason!,
  });
}
