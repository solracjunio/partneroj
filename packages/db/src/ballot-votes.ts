// Voting (plan section 3, "Votação"): one yes or no per voter of the
// frozen electorate, never changed, while the ballot is open. Whether it
// is open is the domain's tally, not only the outcome recorded: a ballot
// whose result can't change any more, whose deadline passed or whose
// entry the author reversed is closed, even before block 4's job records
// it.
import { tallyBallot, type Ballot } from "@partneroj/domain";
import { and, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import { isForeignKeyViolation, isUniqueViolation } from "./pg-errors.js";
import { ballots, ballotVoters, entries, votes } from "./schema.js";

/** Why a vote was refused; the API turns each into a response. */
export type VoteRefusal =
  "ballot-not-found" | "ballot-closed" | "already-voted" | "not-voter";

export class VoteRefused extends Error {
  constructor(readonly reason: VoteRefusal) {
    super(reason);
    this.name = "VoteRefused";
  }
}

/**
 * The ballot as the domain counts it (tallyBallot): its rule, frozen
 * electorate, deadline, votes, and when the entry's author reversed it,
 * if they did. Undefined for a ballot that doesn't exist.
 */
export async function loadBallot(
  db: Database | Transaction,
  ballotId: string,
): Promise<Ballot | undefined> {
  const [row] = await db
    .select({
      rule: ballots.rule,
      closesAt: ballots.closesAt,
      entryId: ballots.entryId,
    })
    .from(ballots)
    .where(eq(ballots.id, ballotId));
  if (row === undefined) return undefined;

  const electorate = await db
    .select({ memberId: ballotVoters.memberId })
    .from(ballotVoters)
    .where(eq(ballotVoters.ballotId, ballotId));
  const cast = await db
    .select({
      voter: votes.memberId,
      approve: votes.approve,
      at: votes.castAt,
    })
    .from(votes)
    // In no order: the tally sorts them by time.
    .where(eq(votes.ballotId, ballotId));

  return {
    rule: row.rule,
    electorate: electorate.map((v) => v.memberId),
    closesAt: row.closesAt,
    votes: cast.map((v) => ({
      voter: v.voter,
      vote: v.approve ? "yes" : "no",
      at: v.at,
    })),
    reversedAt:
      row.entryId === null ? undefined : await reversedAt(db, row.entryId),
  };
}

/** When the entry was reversed: an entry has at most one reversal. */
async function reversedAt(
  db: Database | Transaction,
  entryId: string,
): Promise<Date | undefined> {
  const [reversal] = await db
    .select({ at: entries.createdAt })
    .from(entries)
    .where(eq(entries.reversalOf, entryId));
  return reversal?.at;
}

/**
 * Records the actor's vote on a ballot of their partnership while it is
 * open. The database keeps the rest: the foreign key to ballot_voters
 * refuses anyone outside the frozen electorate, and the primary key a
 * second vote, even two sent at the same moment.
 */
export async function castVote(
  db: Database,
  actor: { memberId: string; partnershipId: string },
  request: { ballotId: string; vote: "yes" | "no" },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [found] = await tx
        .select({ outcome: ballots.outcome })
        .from(ballots)
        .where(
          and(
            eq(ballots.id, request.ballotId),
            eq(ballots.partnershipId, actor.partnershipId),
          ),
        );
      // Another partnership's ballot looks the same as one that doesn't exist.
      if (found === undefined) throw new VoteRefused("ballot-not-found");
      if (found.outcome !== null) throw new VoteRefused("ballot-closed");
      const ballot = (await loadBallot(tx, request.ballotId))!;
      const now = new Date();
      // Whether the proposal still applies only matters once it is
      // approved, and then the ballot is closed either way.
      if (tallyBallot(ballot, now, () => true).state === "closed") {
        throw new VoteRefused("ballot-closed");
      }
      await tx.insert(votes).values({
        ballotId: request.ballotId,
        memberId: actor.memberId,
        approve: request.vote === "yes",
        // The moment the tally judged it in time, not the database's
        // clock: on a clock a little ahead, a vote judged in time could be
        // stored after the deadline, and the tally would drop it.
        castAt: now,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new VoteRefused("already-voted");
    if (isForeignKeyViolation(error)) throw new VoteRefused("not-voter");
    throw error;
  }
}
