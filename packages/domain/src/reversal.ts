// Immutable entries and their reversals (plan section 3, "Imutabilidade, estorno e períodos").
import { computeBalances, type Entry } from "./balances.js";
import { DomainError } from "./errors.js";
import type { Share } from "./split.js";

/** An entry as recorded: never updated or deleted, only reversed. */
export type LedgerEntry = Entry & {
  id: string;
  category?: string;
  /** Set on a reversal: the id of the entry it cancels. */
  reversalOf?: string;
  /** Why it was reversed; required on a reversal. */
  reason?: string;
};

export interface ReversalRequest {
  id: string;
  originalId: string;
  reason: string;
}

export function createReversal(
  ledger: readonly LedgerEntry[],
  shares: readonly Share[],
  request: ReversalRequest,
): LedgerEntry {
  const reason = request.reason.trim();
  if (reason === "")
    throw new DomainError("reason-required", "A reversal needs a reason");
  const original = ledger.find((e) => e.id === request.originalId);
  if (!original)
    throw new DomainError("entry-not-found", `No entry ${request.originalId}`);
  // To undo a reversal, record a new entry instead.
  if (original.reversalOf !== undefined)
    throw new DomainError("reversal-of-reversal", "A reversal is final");
  if (ledger.some((e) => e.reversalOf === original.id))
    throw new DomainError("already-reversed", `${original.id} is reversed`);
  const reversal: LedgerEntry = {
    ...original,
    id: request.id,
    amount: -original.amount,
    reversalOf: original.id,
    reason,
  };
  assertCanRecord(ledger, shares, reversal);
  return reversal;
}

/** Refuses an entry or reversal that would leave any account below zero. */
export function assertCanRecord(
  ledger: readonly Entry[],
  shares: readonly Share[],
  entry: Entry,
): void {
  const { accounts } = computeBalances([...ledger, entry], shares);
  for (const [account, balance] of accounts) {
    if (balance < 0n)
      throw new DomainError(
        "account-overdrawn",
        `Account ${account} would go below zero`,
      );
  }
}

export type EntryStatus = "confirmed" | "in-vote" | "reversed";

/**
 * Derived, never stored: an entry has no status field, so it can never
 * disagree with its reversals and votes.
 */
export function statusOf(
  ledger: readonly LedgerEntry[],
  entryId: string,
  openVotes: ReadonlySet<string>,
): EntryStatus {
  if (ledger.some((e) => e.reversalOf === entryId)) return "reversed";
  if (openVotes.has(entryId)) return "in-vote";
  return "confirmed";
}
