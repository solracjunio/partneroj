// Counting a ballot (plan section 3, "Votação"; ADR 0004).
//
// The moment a ballot closes comes from its events, never from the clock:
// the vote that makes the result certain, the author's reversal, or the
// deadline, whichever is first. So the job at the deadline and a read
// after it (when the worker was down) always agree on the outcome and on
// when it closed, however many times either runs.

/** How long a ballot stays open. */
export const BALLOT_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * "majority": more than half of the frozen electorate says yes.
 * "unanimity": everyone does (ADR 0004: the partnership's setting for
 * ballots on entries; ballots on members are always by majority).
 */
export type BallotRule = "majority" | "unanimity";

export interface CastVote {
  voter: string;
  vote: "yes" | "no";
  at: Date;
}

export interface Ballot {
  rule: BallotRule;
  /** Who may vote, frozen when it opened: later role changes don't count. */
  electorate: readonly string[];
  closesAt: Date;
  /** One per voter: a vote can't be changed. */
  votes: readonly CastVote[];
  /** When the entry's author reversed it, if they did. */
  reversedAt?: Date | undefined;
}

/**
 * "moot": the author reversed the entry before the end, so there is
 * nothing left to change. "no-effect": approved, but applying it would
 * now break a rule (an account below zero, after entries made since it
 * opened).
 */
export type Outcome = "approved" | "rejected" | "moot" | "no-effect";

export type Tally =
  | { state: "open"; yes: number; no: number }
  | {
      state: "closed";
      outcome: Outcome;
      closedAt: Date;
      yes: number;
      no: number;
    };

export function closesAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + BALLOT_DAYS * DAY_MS);
}

/**
 * The ballot as of `now`. `proposalApplies` is asked only when it was
 * approved: whether the reversal (and the corrected entry) can still be
 * recorded.
 */
export function tallyBallot(
  ballot: Ballot,
  now: Date,
  proposalApplies: () => boolean,
): Tally {
  assertValid(ballot);
  const end = votingEnd(ballot);
  const reversedAt = ballot.reversedAt;

  // A reversal at the same moment as the end didn't come before it.
  // Stryker disable next-line ConditionalExpression: `undefined < date` is false anyway; the check is for the compiler.
  if (reversedAt !== undefined && reversedAt < end.at) {
    if (now < reversedAt) return { state: "open", ...countUntil(ballot, now) };
    return {
      state: "closed",
      outcome: "moot",
      closedAt: reversedAt,
      ...countUntil(ballot, reversedAt),
    };
  }
  if (now < end.at) return { state: "open", ...countUntil(ballot, now) };

  const outcome = !end.approved
    ? "rejected"
    : proposalApplies()
      ? "approved"
      : "no-effect";
  return {
    state: "closed",
    outcome,
    closedAt: end.at,
    yes: end.yes,
    no: end.no,
  };
}

interface End {
  at: Date;
  approved: boolean;
  yes: number;
  no: number;
}

/**
 * When the votes alone end it: the first vote after which the result
 * can't change, or else the deadline. Whoever didn't vote by then counts
 * as no, so a ballot that reaches the deadline undecided is rejected.
 */
function votingEnd(ballot: Ballot): End {
  const total = ballot.electorate.length;
  let yes = 0;
  let no = 0;
  for (const v of inTimeOrder(ballot)) {
    if (v.vote === "yes") yes++;
    else no++;
    const approved = decided(ballot.rule, yes, no, total);
    if (approved !== null) return { at: v.at, approved, yes, no };
  }
  return { at: ballot.closesAt, approved: false, yes, no };
}

/** True once approved, false once rejected, null while it can change. */
function decided(
  rule: BallotRule,
  yes: number,
  no: number,
  total: number,
): boolean | null {
  if (rule === "unanimity") {
    if (no > 0) return false;
    return yes === total ? true : null;
  }
  if (2 * yes > total) return true;
  // Even if everyone left said yes, it wouldn't be more than half.
  if (2 * (total - no) <= total) return false;
  return null;
}

/** The votes cast before the deadline, oldest first. */
function inTimeOrder(ballot: Ballot): CastVote[] {
  return ballot.votes
    .filter((v) => v.at < ballot.closesAt)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function countUntil(ballot: Ballot, moment: Date): { yes: number; no: number } {
  const counted = inTimeOrder(ballot).filter((v) => v.at <= moment);
  const yes = counted.filter((v) => v.vote === "yes").length;
  return { yes, no: counted.length - yes };
}

function assertValid(ballot: Ballot): void {
  if (ballot.electorate.length === 0)
    // Stryker disable next-line StringLiteral: a fixed text with nothing to identify; the tests check the error.
    throw new RangeError("A ballot needs an electorate");
  const electorate = new Set(ballot.electorate);
  const voted = new Set<string>();
  for (const { voter } of ballot.votes) {
    if (!electorate.has(voter))
      throw new RangeError(`${voter} is not in this ballot's electorate`);
    if (voted.has(voter)) throw new RangeError(`${voter} voted twice`);
    voted.add(voter);
  }
}
