// Opening a ballot on an entry (plan section 3, "Votação"). The rules are
// the domain's (assertCanOpenEntryBallot); this file loads what they need,
// checks that every id the request brings belongs to the actor's
// partnership, and writes the ballot, its frozen electorate and the entry
// a correction proposes in one transaction. Closing it and applying the
// outcome come with block 4.
import {
  assertCanOpenEntryBallot,
  closesAt,
  DomainError,
  type DomainErrorCode,
  type EarlierBallot,
  type Proposal,
} from "@partneroj/domain";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import { loadLedger, toDomainEntry } from "./ledger.js";
import { isUniqueViolation } from "./pg-errors.js";
import { MAX_REASON_LENGTH } from "./reversals.js";
import {
  accounts,
  ballotProposedEntries,
  ballots,
  ballotVoters,
  categories,
  entries,
  members,
  partnerships,
  periods,
  projects,
  weights,
} from "./schema.js";

/** Why a ballot was refused; the API turns each into a response. */
export type EntryBallotRefusal =
  | DomainErrorCode
  | "not-voter"
  | "member-without-weight"
  | "account-not-found"
  | "category-not-found";

export class EntryBallotRefused extends Error {
  constructor(readonly reason: EntryBallotRefusal) {
    super(reason);
    this.name = "EntryBallotRefused";
  }
}

/** The entry a correction proposes, as ballot_proposed_entries keeps it. */
export type NewProposedEntry = Omit<
  typeof ballotProposedEntries.$inferInsert,
  "ballotId" | "proposal"
>;

export type EntryBallotProposal =
  { kind: "archive" } | { kind: "correct"; entry: NewProposedEntry };

export interface EntryBallotRequest {
  entryId: string;
  reason: string;
  proposal: EntryBallotProposal;
}

interface Actor {
  memberId: string;
  partnershipId: string;
}

/**
 * Opens a ballot on an entry of the actor's partnership, decided by the
 * partnership's rule as it is now and voted by its admins and partners as
 * they are now: both are copied into the ballot and never change.
 *
 * Two requests at the same moment can both pass the domain's "one ballot
 * per entry"; the unique index ballots_entry_once lets only one insert,
 * and the other is refused as a ballot already open.
 */
export async function openEntryBallot(
  db: Database,
  actor: Actor,
  request: EntryBallotRequest,
): Promise<{ ballotId: string; closesAt: Date }> {
  try {
    return await db.transaction((tx) => openIn(tx, actor, request));
  } catch (error) {
    if (isUniqueViolation(error)) throw new EntryBallotRefused("ballot-open");
    if (error instanceof DomainError) throw new EntryBallotRefused(error.code);
    throw error;
  }
}

async function openIn(
  tx: Transaction,
  actor: Actor,
  request: EntryBallotRequest,
): Promise<{ ballotId: string; closesAt: Date }> {
  // The API checks the length first; a longer one here is a bug.
  if (request.reason.trim().length > MAX_REASON_LENGTH) {
    throw new RangeError("reason too long");
  }
  const projectId = await entryProject(tx, actor, request.entryId);
  await assertVoter(tx, actor);
  if (request.proposal.kind === "correct") {
    await assertPartiesOf(tx, actor, projectId, request.proposal.entry);
  }

  const ledger = await loadLedger(tx, projectId);
  assertCanOpenEntryBallot({
    ledger: ledger.entries,
    weights: ledger.weights,
    ballots: await earlierBallots(tx, projectId),
    request: { ...request, proposal: toDomainProposal(request.proposal) },
    settlementAnnounced: await settlementAnnounced(tx, projectId),
    periods: await projectPeriods(tx, projectId),
  });

  return record(tx, actor, request);
}

/** The entry's project, if the entry is the actor's partnership's. */
async function entryProject(
  tx: Transaction,
  actor: Actor,
  entryId: string,
): Promise<string> {
  const [found] = await tx
    .select({ projectId: entries.projectId })
    .from(entries)
    .innerJoin(projects, eq(projects.id, entries.projectId))
    .where(
      and(
        eq(entries.id, entryId),
        eq(projects.partnershipId, actor.partnershipId),
      ),
    );
  // Another partnership's entry looks the same as one that doesn't exist.
  if (found === undefined) throw new EntryBallotRefused("entry-not-found");
  return found.projectId;
}

/** Only who votes opens a ballot (plan section 2): a reader doesn't. */
async function assertVoter(tx: Transaction, actor: Actor): Promise<void> {
  const [member] = await tx
    .select({ role: members.role })
    .from(members)
    .where(
      and(
        eq(members.id, actor.memberId),
        eq(members.partnershipId, actor.partnershipId),
      ),
    );
  if (member === undefined || member.role === "reader") {
    throw new EntryBallotRefused("not-voter");
  }
}

/**
 * Every id a correction names is the partnership's: each member has a
 * weight in the project (the domain splits by weight, and a member of
 * another partnership has none), each account and the category belong to
 * the partnership. The foreign keys only say they exist.
 */
async function assertPartiesOf(
  tx: Transaction,
  actor: Actor,
  projectId: string,
  entry: NewProposedEntry,
): Promise<void> {
  const memberIds = [entry.fromMemberId, entry.toMemberId].filter(present);
  if (memberIds.length > 0) {
    const weighted = await tx
      .select({ memberId: weights.memberId })
      .from(weights)
      .where(
        and(
          eq(weights.projectId, projectId),
          inArray(weights.memberId, memberIds),
        ),
      );
    if (weighted.length !== new Set(memberIds).size) {
      throw new EntryBallotRefused("member-without-weight");
    }
  }

  const accountIds = [entry.fromAccountId, entry.toAccountId].filter(present);
  if (accountIds.length > 0) {
    const owned = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.partnershipId, actor.partnershipId),
          inArray(accounts.id, accountIds),
        ),
      );
    if (owned.length !== new Set(accountIds).size) {
      throw new EntryBallotRefused("account-not-found");
    }
  }

  if (present(entry.categoryId)) {
    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, entry.categoryId),
          eq(categories.partnershipId, actor.partnershipId),
        ),
      );
    if (category === undefined) {
      throw new EntryBallotRefused("category-not-found");
    }
  }
}

function present(id: string | null | undefined): id is string {
  return id !== null && id !== undefined;
}

/** The project's ballots on entries so far: open, or closed with their outcome. */
async function earlierBallots(
  tx: Transaction,
  projectId: string,
): Promise<EarlierBallot[]> {
  const rows = await tx
    .select({ entryId: ballots.entryId, outcome: ballots.outcome })
    .from(ballots)
    .innerJoin(entries, eq(entries.id, ballots.entryId))
    .where(eq(entries.projectId, projectId));
  return rows.map((b) => ({
    // Every row here is on an entry: the join went through entry_id.
    entryId: b.entryId!,
    // An open ballot has no outcome yet. Were it taken for any other
    // status, ballots_entry_once would still refuse the second one.
    status: b.outcome ?? "open",
  }));
}

async function settlementAnnounced(
  tx: Transaction,
  projectId: string,
): Promise<boolean> {
  const [announced] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        isNotNull(projects.settlementAnnouncedAt),
      ),
    );
  return announced !== undefined;
}

async function projectPeriods(tx: Transaction, projectId: string) {
  const rows = await tx
    .select({
      startsOn: periods.startsOn,
      endsOn: periods.endsOn,
      closedAt: periods.closedAt,
    })
    .from(periods)
    .where(eq(periods.projectId, projectId));
  return rows.map((p) => ({
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    closed: p.closedAt !== null,
  }));
}

function toDomainProposal(proposal: EntryBallotProposal): Proposal {
  if (proposal.kind === "archive") return proposal;
  const entry = proposal.entry;
  return {
    kind: "correct",
    entry: {
      ...toDomainEntry(
        {
          type: entry.type,
          amount: entry.amount,
          fromMemberId: entry.fromMemberId ?? null,
          fromAccountId: entry.fromAccountId ?? null,
          toMemberId: entry.toMemberId ?? null,
          toAccountId: entry.toAccountId ?? null,
        },
        "the proposed entry",
      ),
      accrualOn: entry.accrualOn,
    },
  };
}

/** The ballot, its frozen electorate and, on a correction, the proposed entry. */
async function record(
  tx: Transaction,
  actor: Actor,
  request: EntryBallotRequest,
): Promise<{ ballotId: string; closesAt: Date }> {
  const [partnership] = await tx
    .select({ rule: partnerships.entryBallotRule })
    .from(partnerships)
    .where(eq(partnerships.id, actor.partnershipId));
  const openedAt = new Date();
  const [ballot] = await tx
    .insert(ballots)
    .values({
      partnershipId: actor.partnershipId,
      kind: "entry",
      entryId: request.entryId,
      proposal: request.proposal.kind,
      rule: partnership!.rule,
      openedBy: actor.memberId,
      reason: request.reason,
      openedAt,
      closesAt: closesAt(openedAt),
    })
    .returning({ id: ballots.id, closesAt: ballots.closesAt });

  const electorate = await tx
    .select({ memberId: members.id })
    .from(members)
    .where(
      and(
        eq(members.partnershipId, actor.partnershipId),
        inArray(members.role, ["admin", "partner"]),
      ),
    );
  await tx
    .insert(ballotVoters)
    .values(electorate.map((m) => ({ ballotId: ballot!.id, ...m })));

  if (request.proposal.kind === "correct") {
    await tx
      .insert(ballotProposedEntries)
      .values({ ...request.proposal.entry, ballotId: ballot!.id });
  }
  return { ballotId: ballot!.id, closesAt: ballot!.closesAt };
}
