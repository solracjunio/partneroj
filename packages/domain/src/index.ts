// Pure business rules: weighted split, settlement, debt simplification and vote counting.
// No framework, database or I/O here (see docs/adr).
export { splitByWeights, type Weight } from "./split.js";
export {
  computeBalances,
  type Balances,
  type Entry,
  type Party,
  type PartnerBalance,
} from "./balances.js";
export { DomainError, type DomainErrorCode } from "./errors.js";
export {
  BALLOT_DAYS,
  closesAt,
  tallyBallot,
  type Ballot,
  type BallotRule,
  type CastVote,
  type Outcome,
  type Tally,
} from "./ballot.js";
export {
  assertCanRecord,
  createReversal,
  statusOf,
  type EntryStatus,
  type LedgerEntry,
  type ReversalRequest,
} from "./reversal.js";
export { totalsByCategory } from "./categories.js";
export { fairShares, sameWeights } from "./contributions.js";
export {
  EXACT_SEARCH_LIMIT,
  greedyTransfers,
  settle,
  settlementParticipants,
  type Participant,
  type Transfer,
} from "./settlement.js";
