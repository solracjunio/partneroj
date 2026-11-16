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
    accrualOn: row.accrualOn,
    ...(row.reversalOf === null ? {} : { reversalOf: row.reversalOf }),
    ...(row.reversalReason === null ? {} : { reason: row.reversalReason }),
    ...(row.createdByBallotId === null
      ? {}
      : { createdByBallot: row.createdByBallotId }),
  };
}
