// A project's ledger as the domain sees it: every entry, reversals
// included, and the weights in draw order. Reversals and balances both
// hand it to the domain's rules.
import type {
  Entry as DomainEntry,
  LedgerEntry,
  Weight,
} from "@partneroj/domain";
import { asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import type { Entry } from "./record-entry.js";
import { entries, weights } from "./schema.js";

export interface Ledger {
  entries: LedgerEntry[];
  /**
   * In the project's draw order, which breaks ties of the extra cent
   * (splitByWeights, ADR 0002): never in insertion order.
   */
  weights: Weight[];
}

/** The project's whole ledger, in the caller's transaction or not. */
export async function loadLedger(
  db: Database | Transaction,
  projectId: string,
): Promise<Ledger> {
  const rows = await db
    .select()
    .from(entries)
    .where(eq(entries.projectId, projectId))
    .orderBy(asc(entries.id));
  const projectWeights = await db
    .select({ partnerId: weights.memberId, weight: weights.weight })
    .from(weights)
    .where(eq(weights.projectId, projectId))
    .orderBy(asc(weights.drawPosition));
  return { entries: rows.map(toLedgerEntry), weights: projectWeights };
}

/**
 * What a row moves: its type, amount and sides. Entries have these
 * columns, and so does the entry a correction proposes.
 */
export type EntryMovement = Pick<
  Entry,
  | "type"
  | "amount"
  | "fromMemberId"
  | "fromAccountId"
  | "toMemberId"
  | "toAccountId"
>;

/** An entry row as the domain sees it, with its id and history. */
function toLedgerEntry(row: Entry): LedgerEntry {
  return {
    ...toDomainEntry(row, `entry ${row.id}`),
    id: row.id,
    accrualOn: row.accrualOn,
    ...(row.reversalOf === null ? {} : { reversalOf: row.reversalOf }),
    ...(row.reversalReason === null ? {} : { reason: row.reversalReason }),
    ...(row.createdByBallotId === null
      ? {}
      : { createdByBallot: row.createdByBallotId }),
  };
}

/**
 * What a row moves, as the domain sees it. Which sides each type has is
 * the domain's rule, checked when the row was recorded: a row without
 * them is a bug, not a refusal. `label` names the row in that error.
 */
export function toDomainEntry(row: EntryMovement, label: string): DomainEntry {
  const side = (member: string | null, account: string | null) => {
    if (member !== null) return { partner: member };
    if (account !== null) return { account };
    throw new Error(`${label} has no party on a side it needs`);
  };
  const need = (value: string | null) => {
    if (value === null) throw new Error(`${label} misses a party`);
    return value;
  };
  const amount = row.amount;
  switch (row.type) {
    case "expense":
      return {
        type: "expense",
        amount,
        from: side(row.fromMemberId, row.fromAccountId),
      };
    case "income":
      return {
        type: "income",
        amount,
        to: side(row.toMemberId, row.toAccountId),
      };
    case "in-kind":
      return { type: "in-kind", amount, partner: need(row.fromMemberId) };
    case "contribution":
    case "opening":
      return {
        type: row.type,
        amount,
        partner: need(row.fromMemberId),
        account: need(row.toAccountId),
      };
    case "withdrawal":
    case "reimbursement":
      return {
        type: row.type,
        amount,
        account: need(row.fromAccountId),
        partner: need(row.toMemberId),
      };
    case "transfer":
      return {
        type: "transfer",
        amount,
        fromAccount: need(row.fromAccountId),
        toAccount: need(row.toAccountId),
      };
  }
}
