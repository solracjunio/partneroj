import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveChoice, createChoice } from "./accounts-categories.js";
import {
  EntryBallotRefused,
  openEntryBallot,
  type NewProposedEntry,
} from "./entry-ballots.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import {
  accounts,
  ballotProposedEntries,
  ballots,
  ballotVoters,
  categories,
  entries,
  members,
  periods,
  projects,
} from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
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
 * Ana and Bruno (admins), Caio (partner) and Davi (reader), weight 1 each
 * but Davi's, and Ana's R$ 350,00 expense on cement.
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
    ...(options.rule === undefined ? {} : { entryBallotRule: options.rule }),
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
  await addCategories(app.db, {
    partnershipId: p.id,
    names: ["Material"],
    actorId: null,
  });
  const [material] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id));
  const [account] = await t.db
    .insert(accounts)
    .values({ partnershipId: p.id, name: "Conta da obra" })
    .returning();
  const [cement] = await t.db
    .insert(entries)
    .values({
      projectId: project.id,
      type: "expense",
      amount: 35000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: ana,
      categoryId: material!.id,
      authorId: ana,
      source: "app",
    })
    .returning();
  const as = (memberId: string) => ({ memberId, partnershipId: p.id });
  return {
    partnershipId: p.id,
    projectId: project.id,
    ana: as(ana),
    bruno: as(bruno),
    caio: as(caio),
    davi: as(davi),
    categoryId: material!.id,
    accountId: account!.id,
    entryId: cement!.id,
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

const archive = (s: Seed, reason = "Não foi gasto da obra") => ({
  entryId: s.entryId,
  reason,
  proposal: { kind: "archive" as const },
});

/** The cement was R$ 305,00, paid by Ana: what a correction proposes. */
const corrected = (s: Seed): NewProposedEntry => ({
  type: "expense",
  amount: 30500n,
  occurredOn: "2027-01-12",
  accrualOn: "2027-01-12",
  fromMemberId: s.ana.memberId,
  categoryId: s.categoryId,
  description: "cimento",
});

const correct = (s: Seed, entry: Partial<NewProposedEntry> = {}) => ({
  entryId: s.entryId,
  reason: "O valor certo é R$ 305,00",
  proposal: { kind: "correct" as const, entry: { ...corrected(s), ...entry } },
});

/** Waits until some session is blocked on a lock, as on the unique index. */
async function waitForALockWait(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const { rows } = await t.db.$client.query(
      "select 1 from pg_stat_activity where wait_event_type = 'Lock'",
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("no session ever waited on a lock");
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EntryBallotRefused) return error.reason;
    throw error;
  }
  return "opened";
}

/** Everything opening a ballot writes, for the partnership. */
async function written(s: Seed) {
  const rows = await t.db
    .select()
    .from(ballots)
    .where(eq(ballots.partnershipId, s.partnershipId));
  const ids = rows.map((b) => b.id);
  const voters = [];
  const proposed = [];
  for (const id of ids) {
    voters.push(
      ...(await t.db
        .select()
        .from(ballotVoters)
        .where(eq(ballotVoters.ballotId, id))),
    );
    proposed.push(
      ...(await t.db
        .select()
        .from(ballotProposedEntries)
        .where(eq(ballotProposedEntries.ballotId, id))),
    );
  }
  return { ballots: rows, voters, proposed };
}

describe("openEntryBallot records", () => {
  it("a ballot to archive, with the partnership's rule and a week to vote", async () => {
    for (const rule of ["majority", "unanimity"] as const) {
      const s = await seed({ rule });
      const before = Date.now();
      const opened = await openEntryBallot(app.db, s.bruno, archive(s));
      const [ballot] = (await written(s)).ballots;
      expect(ballot).toMatchObject({
        id: opened.ballotId,
        kind: "entry",
        entryId: s.entryId,
        proposal: "archive",
        rule,
        openedBy: s.bruno.memberId,
        reason: "Não foi gasto da obra",
        outcome: null,
      });
      expect(ballot!.openedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(ballot!.closesAt.getTime() - ballot!.openedAt.getTime()).toBe(
        7 * DAY_MS,
      );
      expect(opened.closesAt).toEqual(ballot!.closesAt);
      expect((await written(s)).proposed).toEqual([]);
    }
  });

  it("the entry a correction proposes, every column of it", async () => {
    const s = await seed();
    const opened = await openEntryBallot(app.db, s.caio, correct(s));
    const { ballots: rows, proposed } = await written(s);
    expect(rows[0]!.proposal).toBe("correct");
    expect(proposed).toEqual([
      {
        ballotId: opened.ballotId,
        proposal: "correct",
        fromAccountId: null,
        toMemberId: null,
        toAccountId: null,
        ...corrected(s),
      },
    ]);
  });

  it("the electorate: today's admins and partners, the author and the opener among them, no reader", async () => {
    const s = await seed();
    await openEntryBallot(app.db, s.bruno, archive(s));
    const { voters } = await written(s);
    expect(voters.map((v) => v.memberId).sort()).toEqual(
      [s.ana.memberId, s.bruno.memberId, s.caio.memberId].sort(),
    );
  });

  it("a frozen electorate: promoting the reader later doesn't add a voter", async () => {
    const s = await seed();
    await openEntryBallot(app.db, s.bruno, archive(s));
    await t.db
      .update(members)
      .set({ role: "partner" })
      .where(eq(members.id, s.davi.memberId));
    const { voters } = await written(s);
    expect(voters.map((v) => v.memberId)).not.toContain(s.davi.memberId);
  });
});

describe("openEntryBallot refuses, writing nothing", () => {
  async function expectNothingWritten(s: Seed) {
    expect(await written(s)).toEqual({ ballots: [], voters: [], proposed: [] });
  }

  it("another partnership's entry, as if it didn't exist", async () => {
    const s = await seed();
    const other = await seed({ name: "Outra Obra" });
    expect(
      await refusal(openEntryBallot(app.db, other.bruno, archive(s))),
    ).toBe("entry-not-found");
    expect(
      await refusal(
        openEntryBallot(app.db, s.bruno, {
          ...archive(s),
          entryId: "0190f0f0-0000-7000-8000-000000000000",
        }),
      ),
    ).toBe("entry-not-found");
    await expectNothingWritten(s);
  });

  it("a reason longer than a reversal's, as a bug: the API checks it first", async () => {
    const s = await seed();
    await expect(
      openEntryBallot(app.db, s.bruno, archive(s, "x".repeat(201))),
    ).rejects.toThrow(RangeError);
    expect(
      await refusal(
        openEntryBallot(app.db, s.bruno, archive(s, "x".repeat(200))),
      ),
    ).toBe("opened");
  });

  it("a reader: they don't vote, so they don't open ballots", async () => {
    const s = await seed();
    expect(await refusal(openEntryBallot(app.db, s.davi, archive(s)))).toBe(
      "not-voter",
    );
    // A member id that isn't the partnership's, as no session would give.
    const other = await seed({ name: "Obra de Fora" });
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          { memberId: other.bruno.memberId, partnershipId: s.partnershipId },
          archive(s),
        ),
      ),
    ).toBe("not-voter");
    await expectNothingWritten(s);
  });

  it("a correction naming someone without a weight in the project", async () => {
    const s = await seed();
    const other = await seed({ name: "Obra Vizinha" });
    for (const memberId of [s.davi.memberId, other.ana.memberId]) {
      for (const sides of [
        { fromMemberId: memberId },
        {
          type: "income" as const,
          fromMemberId: null,
          toMemberId: memberId,
          categoryId: null,
        },
      ])
        expect(
          await refusal(openEntryBallot(app.db, s.bruno, correct(s, sides))),
        ).toBe("member-without-weight");
    }
    await expectNothingWritten(s);
  });

  it("a correction with another partnership's account or category", async () => {
    const s = await seed();
    const other = await seed({ name: "Obra Alheia" });
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, { fromMemberId: null, fromAccountId: other.accountId }),
        ),
      ),
    ).toBe("account-not-found");
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, {
            type: "transfer",
            fromMemberId: null,
            categoryId: null,
            fromAccountId: s.accountId,
            toAccountId: other.accountId,
          }),
        ),
      ),
    ).toBe("account-not-found");
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, { categoryId: other.categoryId }),
        ),
      ),
    ).toBe("category-not-found");
    await expectNothingWritten(s);
  });

  // Their buttons are gone: the same answer as an account or category
  // that isn't the partnership's.
  it("a correction with an archived account or category", async () => {
    const s = await seed();
    const bank = await createChoice(app.db, s.ana, "account", "Banco");
    await archiveChoice(app.db, s.ana, "account", s.accountId);
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, { fromMemberId: null, fromAccountId: s.accountId }),
        ),
      ),
    ).toBe("account-not-found");
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, {
            type: "transfer",
            fromMemberId: null,
            categoryId: null,
            fromAccountId: bank.id,
            toAccountId: s.accountId,
          }),
        ),
      ),
    ).toBe("account-not-found");
    await archiveChoice(app.db, s.ana, "category", s.categoryId);
    expect(await refusal(openEntryBallot(app.db, s.bruno, correct(s)))).toBe(
      "category-not-found",
    );
    await expectNothingWritten(s);
  });

  // Approving it would reverse the entry, and the reversal would move
  // money through the archived account: the same refusal as an undo.
  it("a ballot on an entry through an archived account", async () => {
    const s = await seed();
    const bank = await createChoice(app.db, s.ana, "account", "Banco");
    const base = {
      projectId: s.projectId,
      occurredOn: "2027-01-13",
      accrualOn: "2027-01-13",
      authorId: s.ana.memberId,
      source: "app" as const,
      amount: 10000n,
    };
    const [contribution] = await t.db
      .insert(entries)
      .values({
        ...base,
        type: "contribution",
        fromMemberId: s.ana.memberId,
        toAccountId: s.accountId,
      })
      .returning();
    const [transfer] = await t.db
      .insert(entries)
      .values({
        ...base,
        type: "transfer",
        fromAccountId: s.accountId,
        toAccountId: bank.id,
      })
      .returning();
    await archiveChoice(app.db, s.ana, "account", s.accountId);
    // The account is the transfer's "from" side and the contribution's "to".
    for (const entry of [transfer!, contribution!]) {
      const onIt = { ...archive(s), entryId: entry.id };
      expect(await refusal(openEntryBallot(app.db, s.bruno, onIt))).toBe(
        "account-archived",
      );
    }
    expect(
      await refusal(
        openEntryBallot(app.db, s.bruno, {
          ...correct(s),
          entryId: transfer!.id,
        }),
      ),
    ).toBe("account-archived");
    await expectNothingWritten(s);
  });

  it("what the domain refuses, with the domain's code", async () => {
    const s = await seed();
    expect(
      await refusal(openEntryBallot(app.db, s.bruno, archive(s, "  "))),
    ).toBe("reason-required");
    // A correction from the account, which holds nothing.
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, { fromMemberId: null, fromAccountId: s.accountId }),
        ),
      ),
    ).toBe("account-overdrawn");
    await expectNothingWritten(s);
  });

  it("an entry or a correction in a closed period", async () => {
    const s = await seed();
    await t.db.insert(periods).values({
      projectId: s.projectId,
      startsOn: "2027-02-01",
      endsOn: "2027-02-28",
      closedBy: s.ana.memberId,
      closedAt: new Date(),
    });
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, { accrualOn: "2027-02-10" }),
        ),
      ),
    ).toBe("period-closed");
    await expectNothingWritten(s);
    // An open period holding the day refuses nothing.
    await t.db.insert(periods).values({
      projectId: s.projectId,
      startsOn: "2027-03-01",
      endsOn: "2027-03-31",
    });
    expect(
      await refusal(
        openEntryBallot(
          app.db,
          s.bruno,
          correct(s, { accrualOn: "2027-03-10" }),
        ),
      ),
    ).toBe("opened");
  });

  it("any ballot once the final settlement is announced", async () => {
    const s = await seed();
    await t.db
      .update(projects)
      .set({ settlementAnnouncedAt: new Date() })
      .where(eq(projects.id, s.projectId));
    expect(await refusal(openEntryBallot(app.db, s.bruno, archive(s)))).toBe(
      "settlement-announced",
    );
    await expectNothingWritten(s);
  });

  it("an entry already reversed", async () => {
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
      reversalReason: "Lancei duas vezes",
    });
    expect(await refusal(openEntryBallot(app.db, s.bruno, archive(s)))).toBe(
      "already-reversed",
    );
    await expectNothingWritten(s);
  });
});

describe("openEntryBallot and the earlier ballots", () => {
  it("refuses a second ballot while one is open, and after one was decided", async () => {
    const s = await seed();
    await openEntryBallot(app.db, s.bruno, archive(s));
    expect(await refusal(openEntryBallot(app.db, s.caio, archive(s)))).toBe(
      "ballot-open",
    );
    await t.db
      .update(ballots)
      .set({ outcome: "rejected", closedAt: new Date() })
      .where(eq(ballots.entryId, s.entryId));
    expect(await refusal(openEntryBallot(app.db, s.caio, archive(s)))).toBe(
      "already-contested",
    );
  });

  it("opens again after a ballot with no effect", async () => {
    const s = await seed();
    await openEntryBallot(app.db, s.bruno, archive(s));
    await t.db
      .update(ballots)
      .set({ outcome: "no-effect", closedAt: new Date() })
      .where(eq(ballots.entryId, s.entryId));
    expect(await refusal(openEntryBallot(app.db, s.caio, archive(s)))).toBe(
      "opened",
    );
  });

  it("lets only one of two openings at the same moment through: the index refuses the other", async () => {
    const s = await seed();
    let pending: Promise<string> | undefined;
    // The first opening is written but not yet committed: the second
    // doesn't see it, passes the domain's checks and waits on the unique
    // index until the first commits. Then the index refuses it.
    await t.db.transaction(async (tx) => {
      await tx.insert(ballots).values({
        partnershipId: s.partnershipId,
        kind: "entry",
        entryId: s.entryId,
        proposal: "archive",
        rule: "majority",
        openedBy: s.bruno.memberId,
        reason: "Primeira",
        closesAt: new Date(Date.now() + 7 * DAY_MS),
      });
      pending = refusal(openEntryBallot(app.db, s.caio, archive(s)));
      await waitForALockWait();
    });
    expect(await pending).toBe("ballot-open");
    const { ballots: rows, voters } = await written(s);
    expect(rows.map((b) => b.reason)).toEqual(["Primeira"]);
    expect(voters).toEqual([]);
  });
});
