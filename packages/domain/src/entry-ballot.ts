// Opening a ballot on an entry (plan section 3, "Votação"): who may contest
// what, and whether the proposal can be applied. The counting is ballot.ts.
import type { Entry } from "./balances.js";
import { DomainError } from "./errors.js";
import {
  assertCanRecord,
  createReversal,
  type LedgerEntry,
} from "./reversal.js";
import type { Weight } from "./split.js";

/**
 * "archive": the entry is reversed. "correct": it is reversed and `entry`
 * recorded in its place, in the original author's name.
 */
export type Proposal = { kind: "archive" } | { kind: "correct"; entry: Entry };

export interface EntryBallotRequest {
  entryId: string;
  reason: string;
  proposal: Proposal;
}

export interface EntryBallotContext {
  ledger: readonly LedgerEntry[];
  weights: readonly Weight[];
  /** The project's ballots on entries so far, open or closed. */
  ballots: readonly { entryId: string; open: boolean }[];
  request: EntryBallotRequest;
  /** Once the final settlement is announced, no new ballot opens. */
  settlementAnnounced: boolean;
}

/**
 * Refuses a ballot that can't be opened, with the rule it breaks. Only an
 * entry its author could reverse can be contested, so createReversal's
 * rules apply as they are: the entry exists, isn't a reversal, isn't
 * reversed, and wasn't corrected by a ballot.
 */
export function assertCanOpenEntryBallot(context: EntryBallotContext): void {
  const { ledger, weights, ballots, request } = context;
  if (request.reason.trim() === "")
    // Stryker disable next-line StringLiteral: a fixed text with nothing to identify; the tests check the code.
    throw new DomainError("reason-required", "A ballot needs a reason");
  if (context.settlementAnnounced)
    throw new DomainError(
      "settlement-announced",
      // Stryker disable next-line StringLiteral: a fixed text with nothing to identify; the tests check the code.
      "The final settlement is announced: no new ballots",
    );

  // Only one ballot per entry: a second, even after a rejection, would let
  // anyone contest the same entry again and again.
  const earlier = ballots.find((b) => b.entryId === request.entryId);
  if (earlier?.open)
    throw new DomainError("ballot-open", `${request.entryId} is in a vote`);
  if (earlier !== undefined)
    throw new DomainError(
      "already-contested",
      `${request.entryId} had its ballot`,
    );

  // Checked now as well as when it is approved: a proposal that can't be
  // applied isn't worth a week of voting.
  if (!proposalApplies(ledger, weights, request.entryId, request.proposal))
    throw new DomainError(
      "account-overdrawn",
      // Stryker disable next-line StringLiteral: a fixed text with nothing to identify; the tests check the code.
      "Applying it would leave an account below zero",
    );
}

/**
 * Whether the proposal can be recorded on this ledger: the reversal, and
 * on a correction the new entry after it, without any account below zero.
 * Asked when the ballot opens and again when it is approved, when entries
 * made since may have made it impossible (the "no-effect" outcome). Any
 * other refusal is a bug, not an outcome, and goes through.
 */
export function proposalApplies(
  ledger: readonly LedgerEntry[],
  weights: readonly Weight[],
  entryId: string,
  proposal: Proposal,
): boolean {
  try {
    const reversal = createReversal(ledger, weights, {
      // Stryker disable next-line StringLiteral: never stored; only the balances after it are looked at.
      id: "proposal",
      originalId: entryId,
      reason: "ballot",
    });
    if (proposal.kind === "correct")
      assertCanRecord([...ledger, reversal], weights, proposal.entry);
    return true;
  } catch (error) {
    if (error instanceof DomainError && error.code === "account-overdrawn")
      return false;
    throw error;
  }
}
