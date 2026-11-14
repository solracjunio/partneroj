// "Desfazer" (plan section 5, ADR 0006): an entry is never changed; it is
// undone by a reversal, a new entry with the sign inverted. The rules are
// the domain's (createReversal); this file loads what they need and writes
// the result in the same transaction.
import {
  createReversal,
  DomainError,
  type DomainErrorCode,
} from "@partneroj/domain";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import { recordEntryIn, type Entry } from "./record-entry.js";
import { loadLedger } from "./ledger.js";
import { isUniqueViolation } from "./pg-errors.js";
import { entries, projects } from "./schema.js";

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
  const ledger = await loadLedger(tx, original.projectId);

  const reversal = createReversal(ledger.entries, ledger.weights, {
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
