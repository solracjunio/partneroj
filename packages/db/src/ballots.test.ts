import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLedger } from "./ledger.js";
import {
  accounts,
  ballotProposedEntries,
  ballots,
  ballotVoters,
  entries,
  members,
  partnerships,
  projects,
  votes,
} from "./schema.js";
import {
  connectAsApp,
  pgErrorCode,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

// The database's share of the ballot rules (plan section 3, "Votação").
// The domain says why a ballot can't open; these hold even when two
// requests race, or a bug or a manual session skips the domain.
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

const week = 7 * 24 * 60 * 60 * 1000;

/** The tables a TRUNCATE ... CASCADE of a ballot table reaches. */
const ballotTables = [
  "entries",
  "ballots",
  "ballot_voters",
  "votes",
  "ballot_proposed_entries",
];

/**
 * TRUNCATE ... CASCADE also empties the tables that reference this one,
 * and their own triggers refuse it: to see this table's trigger at work,
 * the others' are disabled, inside a transaction that is rolled back.
 */
async function truncateAlone(table: string): Promise<string> {
  let code = "not run";
  try {
    await t.db.transaction(async (tx) => {
      for (const other of ballotTables.filter((name) => name !== table))
        await tx.execute(sql.raw(`alter table ${other} disable trigger user`));
      code = await pgErrorCode(
        tx.execute(sql.raw(`truncate ${table} cascade`)),
      );
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  return code;
}

/** Three partners and an expense of R$ 350,00 paid by A. */
async function seed() {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Test" })
    .returning();
  const [project] = await t.db
    .insert(projects)
    .values({
      partnershipId: p!.id,
      name: "House",
      kind: "construction",
      startsOn: "2027-01-11",
    })
    .returning();
  const [a, b, c] = await t.db
    .insert(members)
    .values(
      ["A", "B", "C"].map((name) => ({
        partnershipId: p!.id,
        name,
        role: "partner" as const,
      })),
    )
    .returning();
  const [entry] = await t.db
    .insert(entries)
    .values({
      projectId: project!.id,
      type: "expense",
      amount: 35000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: a!.id,
      authorId: a!.id,
      source: "app",
    })
    .returning();
  return {
    partnershipId: p!.id,
    projectId: project!.id,
    a: a!.id,
    b: b!.id,
    c: c!.id,
    entryId: entry!.id,
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/** B contests A's expense, as the app would. */
function entryBallot(
  s: Seed,
  values: Partial<typeof ballots.$inferInsert> = {},
): typeof ballots.$inferInsert {
  return {
    partnershipId: s.partnershipId,
    kind: "entry",
    entryId: s.entryId,
    proposal: "archive",
    rule: "majority",
    openedBy: s.b,
    reason: "Não foi gasto da obra",
    closesAt: new Date(Date.now() + week),
    ...values,
  };
}

async function openBallot(
  s: Seed,
  values: Partial<typeof ballots.$inferInsert> = {},
) {
  const [ballot] = await app.db
    .insert(ballots)
    .values(entryBallot(s, values))
    .returning();
  return ballot!;
}

/** Records an outcome as the tally will: once, from open to closed. */
function close(
  ballotId: string,
  outcome: "approved" | "rejected" | "moot" | "no-effect",
) {
  return app.db
    .update(ballots)
    .set({ outcome, closedAt: new Date() })
    .where(eq(ballots.id, ballotId));
}

// SQLSTATE 23514 check_violation.
describe("a ballot", () => {
  it("is opened by the app, and closed once with its outcome", async () => {
    const s = await seed();
    const ballot = await openBallot(s);
    expect(ballot.outcome).toBeNull();
    expect(await pgErrorCode(close(ballot.id, "rejected"))).toBe("no error");
  });

  it("needs a reason", async () => {
    const s = await seed();
    const insert = t.db.insert(ballots).values(entryBallot(s, { reason: " " }));
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("targets an entry or a member, as its kind says", async () => {
    const s = await seed();
    const refused: Partial<typeof ballots.$inferInsert>[] = [
      { entryId: null },
      { targetMemberId: s.c },
      { kind: "member", proposal: null },
      {
        kind: "member",
        entryId: null,
        targetMemberId: s.c,
        proposal: "archive",
      },
      { proposal: null },
    ];
    for (const values of refused)
      expect(
        await pgErrorCode(t.db.insert(ballots).values(entryBallot(s, values))),
      ).toBe("23514");
  });

  it("needs the rule it is decided by", async () => {
    const s = await seed();
    const withoutRule: Partial<typeof ballots.$inferInsert> = entryBallot(s);
    delete withoutRule.rule;
    const insert = t.db
      .insert(ballots)
      .values(withoutRule as typeof ballots.$inferInsert);
    // 23502 not_null_violation: no default, the rule comes from the partnership.
    expect(await pgErrorCode(insert)).toBe("23502");
  });

  it("is by unanimity only on an entry: a ballot on a member is by majority", async () => {
    const s = await seed();
    expect(await pgErrorCode(openBallot(s, { rule: "unanimity" }))).toBe(
      "no error",
    );
    const onMember = {
      kind: "member" as const,
      entryId: null,
      targetMemberId: s.c,
      proposal: null,
    };
    expect(
      await pgErrorCode(
        t.db
          .insert(ballots)
          .values(entryBallot(s, { ...onMember, rule: "unanimity" })),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(t.db.insert(ballots).values(entryBallot(s, onMember))),
    ).toBe("no error");
  });

  it("closes after it opens", async () => {
    const s = await seed();
    const insert = t.db
      .insert(ballots)
      .values(entryBallot(s, { closesAt: new Date(Date.now() - 1000) }));
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("has an outcome and the time it closed, both or neither, and a reason only with an outcome", async () => {
    const s = await seed();
    for (const values of [
      { outcome: "rejected" as const },
      { closedAt: new Date() },
      { outcomeReason: "Conta X ficaria negativa" },
    ])
      expect(
        await pgErrorCode(t.db.insert(ballots).values(entryBallot(s, values))),
      ).toBe("23514");
  });
});

// SQLSTATE 23505 unique_violation, from ballots_entry_once.
describe("one ballot per entry", () => {
  it("refuses a second ballot while one is open", async () => {
    const s = await seed();
    await openBallot(s);
    expect(await pgErrorCode(openBallot(s))).toBe("23505");
  });

  it("refuses a second ballot after one was decided", async () => {
    for (const outcome of ["approved", "rejected", "moot"] as const) {
      const s = await seed();
      const first = await openBallot(s);
      await close(first.id, outcome);
      expect(await pgErrorCode(openBallot(s))).toBe("23505");
    }
  });

  it("opens again after ballots with no effect, and another entry's ballot doesn't count", async () => {
    const s = await seed();
    for (let i = 0; i < 2; i++) {
      const ballot = await openBallot(s);
      await close(ballot.id, "no-effect");
    }
    expect(await pgErrorCode(openBallot(s))).toBe("no error");
    const other = await seed();
    expect(await pgErrorCode(openBallot(other))).toBe("no error");
  });
});

// SQLSTATE 23001 restrict_violation, raised by refuse_ballot_change().
describe("a ballot's record never changes", () => {
  it("refuses changing a recorded outcome, or reopening it", async () => {
    const s = await seed();
    const ballot = await openBallot(s);
    await close(ballot.id, "rejected");
    expect(await pgErrorCode(close(ballot.id, "approved"))).toBe("23001");
    const reopen = t.db
      .update(ballots)
      .set({ outcome: null, closedAt: null })
      .where(eq(ballots.id, ballot.id));
    expect(await pgErrorCode(reopen)).toBe("23001");
  });

  it("refuses changing what was asked, while open or in the update that closes it", async () => {
    const s = await seed();
    const ballot = await openBallot(s);
    const changes: Partial<typeof ballots.$inferInsert>[] = [
      { reason: "Outro motivo" },
      { proposal: "correct" },
      { rule: "unanimity" },
      { closesAt: new Date(Date.now() + 2 * week) },
      { openedBy: s.c },
      { entryId: (await seed()).entryId },
    ];
    for (const change of changes) {
      const alone = t.db
        .update(ballots)
        .set(change)
        .where(eq(ballots.id, ballot.id));
      expect(await pgErrorCode(alone)).toBe("23001");
      const withOutcome = t.db
        .update(ballots)
        .set({ ...change, outcome: "rejected", closedAt: new Date() })
        .where(eq(ballots.id, ballot.id));
      expect(await pgErrorCode(withOutcome)).toBe("23001");
    }
  });

  it("refuses a DELETE: the owner by the trigger, the app by its privileges", async () => {
    const s = await seed();
    const ballot = await openBallot(s);
    expect(
      await pgErrorCode(t.db.delete(ballots).where(eq(ballots.id, ballot.id))),
    ).toBe("23001");
    // 42501 insufficient_privilege: refused before the trigger runs.
    expect(
      await pgErrorCode(
        app.db.delete(ballots).where(eq(ballots.id, ballot.id)),
      ),
    ).toBe("42501");
    expect(await truncateAlone("ballots")).toBe("23001");
  });
});

describe("the proposed entry of a correction", () => {
  const proposed = (ballotId: string, s: Seed) => ({
    ballotId,
    type: "expense" as const,
    amount: 30500n,
    occurredOn: "2027-01-12",
    accrualOn: "2027-01-12",
    fromMemberId: s.a,
  });

  it("is recorded with a correction", async () => {
    const s = await seed();
    const ballot = await openBallot(s, { proposal: "correct" });
    const insert = app.db
      .insert(ballotProposedEntries)
      .values(proposed(ballot.id, s));
    expect(await pgErrorCode(insert)).toBe("no error");
  });

  // 23503 foreign_key_violation: only a "correct" ballot is referenced.
  it("has no place on a ballot to archive", async () => {
    const s = await seed();
    const ballot = await openBallot(s);
    const insert = app.db
      .insert(ballotProposedEntries)
      .values(proposed(ballot.id, s));
    expect(await pgErrorCode(insert)).toBe("23503");
  });

  it("is one per ballot, positive, with one party per side", async () => {
    const s = await seed();
    const ballot = await openBallot(s, { proposal: "correct" });
    await app.db.insert(ballotProposedEntries).values(proposed(ballot.id, s));
    expect(
      await pgErrorCode(
        app.db.insert(ballotProposedEntries).values(proposed(ballot.id, s)),
      ),
    ).toBe("23505");
    const other = await openBallot(await seed(), { proposal: "correct" });
    const [account] = await t.db
      .insert(accounts)
      .values({ partnershipId: s.partnershipId, name: "Caixa" })
      .returning();
    for (const values of [
      { amount: 0n },
      { amount: -30500n },
      // Paid by A and by the account at once.
      { fromAccountId: account!.id },
    ])
      expect(
        await pgErrorCode(
          t.db
            .insert(ballotProposedEntries)
            .values({ ...proposed(other.id, s), ...values }),
        ),
      ).toBe("23514");
  });
});

describe("the electorate and the votes", () => {
  async function seedVoters() {
    const s = await seed();
    const ballot = await openBallot(s);
    // Frozen when the ballot opens: A and B vote, C joined later.
    await app.db.insert(ballotVoters).values([
      { ballotId: ballot.id, memberId: s.a },
      { ballotId: ballot.id, memberId: s.b },
    ]);
    return { s, ballot };
  }

  it("takes one vote from each voter", async () => {
    const { s, ballot } = await seedVoters();
    const insert = app.db.insert(votes).values([
      { ballotId: ballot.id, memberId: s.a, approve: false },
      { ballotId: ballot.id, memberId: s.b, approve: true },
    ]);
    expect(await pgErrorCode(insert)).toBe("no error");
  });

  // 23503 foreign_key_violation: a vote references the frozen electorate.
  it("refuses the vote of someone outside the electorate", async () => {
    const { s, ballot } = await seedVoters();
    const insert = app.db
      .insert(votes)
      .values({ ballotId: ballot.id, memberId: s.c, approve: true });
    expect(await pgErrorCode(insert)).toBe("23503");
  });

  it("refuses a second vote, even the same one", async () => {
    const { s, ballot } = await seedVoters();
    await app.db
      .insert(votes)
      .values({ ballotId: ballot.id, memberId: s.a, approve: true });
    const again = app.db
      .insert(votes)
      .values({ ballotId: ballot.id, memberId: s.a, approve: true });
    expect(await pgErrorCode(again)).toBe("23505");
  });

  it("refuses a second place in the electorate", async () => {
    const { s, ballot } = await seedVoters();
    const again = app.db
      .insert(ballotVoters)
      .values({ ballotId: ballot.id, memberId: s.a });
    expect(await pgErrorCode(again)).toBe("23505");
  });
});

// Insert-only: the app has no UPDATE nor DELETE (42501), and the trigger
// refuses them to anyone else (23001), TRUNCATE included.
describe("voters, votes and proposed entries are insert-only", () => {
  async function seedAll() {
    const s = await seed();
    const ballot = await openBallot(s, { proposal: "correct" });
    await t.db
      .insert(ballotVoters)
      .values({ ballotId: ballot.id, memberId: s.a });
    await t.db
      .insert(votes)
      .values({ ballotId: ballot.id, memberId: s.a, approve: true });
    await t.db.insert(ballotProposedEntries).values({
      ballotId: ballot.id,
      type: "expense",
      amount: 30500n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: s.a,
    });
    return { s, ballotId: ballot.id };
  }

  it("refuses changing a vote", async () => {
    const { ballotId } = await seedAll();
    const flip = (db: typeof t.db) =>
      db
        .update(votes)
        .set({ approve: false })
        .where(eq(votes.ballotId, ballotId));
    expect(await pgErrorCode(flip(app.db))).toBe("42501");
    expect(await pgErrorCode(flip(t.db))).toBe("23001");
  });

  it("refuses changing a proposed entry", async () => {
    const { ballotId } = await seedAll();
    const change = (db: typeof t.db) =>
      db
        .update(ballotProposedEntries)
        .set({ amount: 1n })
        .where(eq(ballotProposedEntries.ballotId, ballotId));
    expect(await pgErrorCode(change(app.db))).toBe("42501");
    expect(await pgErrorCode(change(t.db))).toBe("23001");
  });

  it("refuses removing a voter, a vote or a proposed entry", async () => {
    const { ballotId } = await seedAll();
    for (const table of [votes, ballotVoters, ballotProposedEntries]) {
      const remove = (db: typeof t.db) =>
        db.delete(table).where(eq(table.ballotId, ballotId));
      expect(await pgErrorCode(remove(app.db))).toBe("42501");
      expect(await pgErrorCode(remove(t.db))).toBe("23001");
    }
    for (const name of ["votes", "ballot_voters", "ballot_proposed_entries"])
      expect(await truncateAlone(name)).toBe("23001");
  });
});

describe("an entry a ballot created", () => {
  it("names the ballot, and only such an entry has the ballot as source", async () => {
    const s = await seed();
    const ballot = await openBallot(s, { proposal: "correct" });
    const corrected = {
      projectId: s.projectId,
      type: "expense" as const,
      amount: 30500n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: s.a,
      authorId: s.a,
    };
    expect(
      await pgErrorCode(
        app.db.insert(entries).values({
          ...corrected,
          source: "ballot",
          createdByBallotId: ballot.id,
        }),
      ),
    ).toBe("no error");
    expect(
      await pgErrorCode(
        t.db.insert(entries).values({ ...corrected, source: "ballot" }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        t.db.insert(entries).values({
          ...corrected,
          source: "app",
          createdByBallotId: ballot.id,
        }),
      ),
    ).toBe("23514");
  });

  it("reaches the domain marked, so it can't be reversed or contested", async () => {
    const s = await seed();
    const ballot = await openBallot(s, { proposal: "correct" });
    await t.db.insert(entries).values({
      projectId: s.projectId,
      type: "expense",
      amount: 30500n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: s.a,
      authorId: s.a,
      source: "ballot",
      createdByBallotId: ballot.id,
    });
    const { entries: ledger } = await loadLedger(t.db, s.projectId);
    expect(ledger.map((e) => e.createdByBallot)).toEqual([
      undefined,
      ballot.id,
    ]);
  });
});
