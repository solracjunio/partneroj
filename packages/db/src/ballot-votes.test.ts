import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { castVote, loadBallot, VoteRefused } from "./ballot-votes.js";
import { openEntryBallot } from "./entry-ballots.js";
import { createPartnership } from "./partnerships.js";
import { createProject } from "./projects.js";
import { ballots, ballotVoters, entries, members, votes } from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
  waitForALockWait,
} from "./testing.js";

let t: TestDatabase;
let app: AppConnection;
beforeAll(async () => {
  t = await startTestDatabase();
  app = await connectAsApp(t);
});
afterAll(async () => {
  await app?.db.$client.end();
  await t?.stop();
});

const DAY_MS = 86_400_000;

/**
 * Ana and Bruno (admins), Caio (partner) and Davi (reader), Ana's
 * R$ 350,00 expense, and Bruno's ballot to archive it.
 */
async function seed(
  options: { rule?: "majority" | "unanimity"; name?: string } = {},
) {
  const p = await createPartnership(app.db, {
    name: options.name ?? "Obra Teste",
    members: [
      { name: "Ana", role: "admin" },
      { name: "Bruno", role: "admin" },
      { name: "Caio", role: "partner" },
      { name: "Davi", role: "reader" },
    ],
    entryBallotRule: options.rule ?? "majority",
    actorId: null,
  });
  const [ana, bruno, caio, davi] = p.members.map((m) => m.id) as [
    string,
    string,
    string,
    string,
  ];
  const project = await createProject(app.db, {
    partnershipId: p.id,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: [ana, bruno, caio].map((memberId) => ({ memberId, weight: 1 })),
    actorId: null,
  });
  const [cement] = await t.db
    .insert(entries)
    .values({
      projectId: project.id,
      type: "expense",
      amount: 35000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: ana,
      authorId: ana,
      source: "app",
    })
    .returning();
  const as = (memberId: string) => ({ memberId, partnershipId: p.id });
  const opened = await openEntryBallot(app.db, as(bruno), {
    entryId: cement!.id,
    reason: "Não foi gasto da obra",
    proposal: { kind: "archive" },
  });
  return {
    partnershipId: p.id,
    projectId: project.id,
    entryId: cement!.id,
    ballotId: opened.ballotId,
    closesAt: opened.closesAt,
    ana: as(ana),
    bruno: as(bruno),
    caio: as(caio),
    davi: as(davi),
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof VoteRefused) return error.reason;
    throw error;
  }
  return "voted";
}

const vote = (
  s: Seed,
  who: { memberId: string; partnershipId: string },
  v: "yes" | "no",
) => refusal(castVote(app.db, who, { ballotId: s.ballotId, vote: v }));

const votesOf = (s: Seed) =>
  t.db.select().from(votes).where(eq(votes.ballotId, s.ballotId));

describe("loadBallot", () => {
  it("gives the domain's ballot: rule, frozen electorate, deadline and votes", async () => {
    const s = await seed({ rule: "unanimity" });
    const before = new Date();
    expect(await vote(s, s.caio, "yes")).toBe("voted");
    const ballot = (await loadBallot(app.db, s.ballotId))!;
    expect(ballot.rule).toBe("unanimity");
    expect([...ballot.electorate].sort()).toEqual(
      [s.ana.memberId, s.bruno.memberId, s.caio.memberId].sort(),
    );
    expect(ballot.closesAt).toEqual(s.closesAt);
    expect(ballot.reversedAt).toBeUndefined();
    const [cast] = ballot.votes;
    expect(ballot.votes).toHaveLength(1);
    expect([cast!.voter, cast!.vote]).toEqual([s.caio.memberId, "yes"]);
    expect(cast!.at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("reads a no as no", async () => {
    const s = await seed();
    await vote(s, s.caio, "no");
    const ballot = await loadBallot(app.db, s.ballotId);
    expect(ballot!.votes.map((v) => v.vote)).toEqual(["no"]);
  });

  it("gives when the author reversed the entry", async () => {
    const s = await seed();
    const [reversal] = await t.db
      .insert(entries)
      .values({
        projectId: s.projectId,
        type: "expense",
        amount: -35000n,
        occurredOn: "2027-01-12",
        accrualOn: "2027-01-12",
        fromMemberId: s.ana.memberId,
        authorId: s.ana.memberId,
        source: "app",
        reversalOf: s.entryId,
        reversalReason: "Lancei errado",
      })
      .returning();
    const ballot = await loadBallot(app.db, s.ballotId);
    expect(ballot!.reversedAt).toEqual(reversal!.createdAt);
  });

  it("gives nothing for a ballot that doesn't exist", async () => {
    expect(
      await loadBallot(app.db, "0190f0f0-0000-7000-8000-000000000000"),
    ).toBeUndefined();
  });
});

describe("castVote", () => {
  it("records each voter's yes or no once", async () => {
    const s = await seed();
    expect(await vote(s, s.ana, "no")).toBe("voted");
    expect(await vote(s, s.caio, "yes")).toBe("voted");
    const rows = await votesOf(s);
    expect(rows.map((r) => [r.memberId, r.approve]).sort()).toEqual(
      [
        [s.ana.memberId, false],
        [s.caio.memberId, true],
      ].sort(),
    );
  });

  it("refuses a second vote, keeping the first", async () => {
    const s = await seed({ rule: "unanimity" });
    await vote(s, s.caio, "yes");
    expect(await vote(s, s.caio, "no")).toBe("already-voted");
    expect((await votesOf(s)).map((r) => r.approve)).toEqual([true]);
  });

  it("refuses someone outside the frozen electorate: a reader, even one promoted after it opened", async () => {
    const s = await seed();
    expect(await vote(s, s.davi, "yes")).toBe("not-voter");
    await t.db
      .update(members)
      .set({ role: "partner" })
      .where(eq(members.id, s.davi.memberId));
    expect(await vote(s, s.davi, "yes")).toBe("not-voter");
    expect(await votesOf(s)).toEqual([]);
  });

  it("refuses another partnership's ballot, as if it didn't exist", async () => {
    const s = await seed();
    const other = await seed({ name: "Outra Obra" });
    expect(await vote(s, other.caio, "yes")).toBe("ballot-not-found");
    expect(
      await refusal(
        castVote(app.db, s.caio, {
          ballotId: "0190f0f0-0000-7000-8000-000000000000",
          vote: "yes",
        }),
      ),
    ).toBe("ballot-not-found");
  });

  it("refuses once the outcome is recorded", async () => {
    const s = await seed();
    await t.db
      .update(ballots)
      .set({ outcome: "rejected", closedAt: new Date() })
      .where(eq(ballots.id, s.ballotId));
    expect(await vote(s, s.caio, "yes")).toBe("ballot-closed");
  });

  it("refuses once the result can't change, before anything is recorded", async () => {
    const unanimous = await seed({ rule: "unanimity" });
    await vote(unanimous, unanimous.ana, "no");
    expect(await vote(unanimous, unanimous.caio, "yes")).toBe("ballot-closed");

    const majority = await seed({ name: "Obra Maioria" });
    await vote(majority, majority.ana, "yes");
    expect(await vote(majority, majority.bruno, "yes")).toBe("voted");
    expect(await vote(majority, majority.caio, "no")).toBe("ballot-closed");
  });

  it("refuses after the deadline", async () => {
    const s = await seed();
    const [late] = await t.db
      .insert(ballots)
      .values({
        partnershipId: s.partnershipId,
        kind: "member",
        targetMemberId: s.davi.memberId,
        rule: "majority",
        openedBy: s.bruno.memberId,
        reason: "Promover o Davi",
        openedAt: new Date(Date.now() - 8 * DAY_MS),
        closesAt: new Date(Date.now() - DAY_MS),
      })
      .returning();
    await t.db.insert(ballotVoters).values(
      [s.ana, s.bruno, s.caio].map((m) => ({
        ballotId: late!.id,
        memberId: m.memberId,
      })),
    );
    expect(
      await refusal(
        castVote(app.db, s.caio, { ballotId: late!.id, vote: "yes" }),
      ),
    ).toBe("ballot-closed");
  });

  it("refuses after the author reversed the entry: nothing is left to decide", async () => {
    const s = await seed();
    await t.db.insert(entries).values({
      projectId: s.projectId,
      type: "expense",
      amount: -35000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: s.ana.memberId,
      authorId: s.ana.memberId,
      source: "app",
      reversalOf: s.entryId,
      reversalReason: "Lancei errado",
    });
    expect(await vote(s, s.caio, "yes")).toBe("ballot-closed");
  });

  it("refuses the second of two votes at the same moment: the primary key does", async () => {
    const s = await seed();
    let pending: Promise<string> | undefined;
    // The first vote is written but not committed: the second doesn't see
    // it, finds the ballot open and waits on the primary key.
    await t.db.transaction(async (tx) => {
      await tx.insert(votes).values({
        ballotId: s.ballotId,
        memberId: s.caio.memberId,
        approve: true,
      });
      pending = vote(s, s.caio, "no");
      await waitForALockWait(t);
    });
    expect(await pending).toBe("already-voted");
    expect((await votesOf(s)).map((r) => r.approve)).toEqual([true]);
  });
});
