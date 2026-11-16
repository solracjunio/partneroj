import { describe, expect, it } from "vitest";
import {
  assertCanOpenEntryBallot,
  proposalApplies,
  type EarlierBallot,
  type EntryBallotRequest,
} from "./entry-ballot.js";
import { DomainError, type DomainErrorCode } from "./errors.js";
import type { Period } from "./periods.js";
import type { LedgerEntry } from "./reversal.js";

const weights = [
  { partnerId: "A", weight: 1 },
  { partnerId: "B", weight: 1 },
  { partnerId: "C", weight: 1 },
];

const cement: LedgerEntry = {
  id: "e1",
  type: "expense",
  amount: 35000n,
  from: { partner: "A" },
  category: "Material",
};

// B put 500 in the account, and 400 of it was spent from there.
const contribution: LedgerEntry = {
  id: "c1",
  type: "contribution",
  amount: 50000n,
  partner: "B",
  account: "X",
};
const spentFromAccount: LedgerEntry = {
  id: "e2",
  type: "expense",
  amount: 40000n,
  from: { account: "X" },
};

const archive = (entryId: string): EntryBallotRequest => ({
  entryId,
  reason: "Não foi gasto da obra",
  proposal: { kind: "archive" },
});

/** The message of the refusal: it names what was refused, for the log. */
function refusalMessage(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.message;
    throw error;
  }
  return undefined;
}

function refusal(action: () => unknown): DomainErrorCode | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

const open = (
  ledger: LedgerEntry[],
  request: EntryBallotRequest,
  ballots: EarlierBallot[] = [],
  settlementAnnounced = false,
  periods: Period[] = [],
) =>
  refusal(() =>
    assertCanOpenEntryBallot({
      ledger,
      weights,
      ballots,
      request,
      settlementAnnounced,
      periods,
    }),
  );

describe("assertCanOpenEntryBallot", () => {
  it("lets anyone contest a confirmed entry, to archive or to correct it", () => {
    expect(open([cement], archive("e1"))).toBeUndefined();
    expect(
      open([cement], {
        entryId: "e1",
        reason: "O valor certo é R$ 305,00",
        proposal: {
          kind: "correct",
          entry: { type: "expense", amount: 30500n, from: { partner: "A" } },
        },
      }),
    ).toBeUndefined();
  });

  it("needs a reason", () => {
    expect(open([cement], { ...archive("e1"), reason: "   " })).toBe(
      "reason-required",
    );
  });

  it("refuses an entry that doesn't exist", () => {
    expect(open([cement], archive("nope"))).toBe("entry-not-found");
  });

  it("refuses a reversal", () => {
    const reversal: LedgerEntry = {
      ...cement,
      id: "r1",
      amount: -35000n,
      reversalOf: "e1",
      reason: "Lancei duas vezes",
    };
    expect(open([cement, reversal], archive("r1"))).toBe(
      "reversal-of-reversal",
    );
  });

  it("refuses an entry already reversed", () => {
    const reversal: LedgerEntry = {
      ...cement,
      id: "r1",
      amount: -35000n,
      reversalOf: "e1",
      reason: "Lancei duas vezes",
    };
    expect(open([cement, reversal], archive("e1"))).toBe("already-reversed");
  });

  it("refuses the entry a ballot corrected: no contests in a row", () => {
    const corrected: LedgerEntry = {
      ...cement,
      id: "e9",
      amount: 30500n,
      createdByBallot: "b1",
    };
    expect(open([corrected], archive("e9"))).toBe("corrected-by-ballot");
  });

  it("allows one open ballot per entry", () => {
    const ballots: EarlierBallot[] = [{ entryId: "e1", status: "open" }];
    expect(open([cement], archive("e1"), ballots)).toBe("ballot-open");
    expect(
      refusalMessage(() =>
        assertCanOpenEntryBallot({
          ledger: [cement],
          weights,
          ballots,
          request: archive("e1"),
          settlementAnnounced: false,
          periods: [],
        }),
      ),
    ).toContain("e1");
  });

  it("refuses an entry that already had its ballot, rejected or otherwise decided", () => {
    for (const status of ["rejected", "approved", "moot"] as const)
      expect(open([cement], archive("e1"), [{ entryId: "e1", status }])).toBe(
        "already-contested",
      );
    expect(
      refusalMessage(() =>
        assertCanOpenEntryBallot({
          ledger: [cement],
          weights,
          ballots: [{ entryId: "e1", status: "rejected" }],
          request: archive("e1"),
          settlementAnnounced: false,
          periods: [],
        }),
      ),
    ).toContain("e1");
    // Another entry's ballot doesn't count.
    expect(
      open([cement], archive("e1"), [{ entryId: "e7", status: "open" }]),
    ).toBeUndefined();
  });

  it("opens again after a ballot with no effect: the majority won, the balance stopped it", () => {
    expect(
      open([cement], archive("e1"), [{ entryId: "e1", status: "no-effect" }]),
    ).toBeUndefined();
    // Any number of times, as long as each one was won.
    expect(
      open([cement], archive("e1"), [
        { entryId: "e1", status: "no-effect" },
        { entryId: "e1", status: "no-effect" },
      ]),
    ).toBeUndefined();
  });

  it("refuses again once a later ballot is decided or open, whatever came first", () => {
    expect(
      open([cement], archive("e1"), [
        { entryId: "e1", status: "no-effect" },
        { entryId: "e1", status: "rejected" },
      ]),
    ).toBe("already-contested");
    expect(
      open([cement], archive("e1"), [
        { entryId: "e1", status: "no-effect" },
        { entryId: "e1", status: "open" },
      ]),
    ).toBe("ballot-open");
  });

  it("refuses an entry of a closed period: its settlement doesn't change", () => {
    const march: Period = {
      startsOn: "2027-03-01",
      endsOn: "2027-03-31",
      closed: true,
    };
    const inMarch = { ...cement, accrualOn: "2027-03-10" };
    expect(open([inMarch], archive("e1"), [], false, [march])).toBe(
      "period-closed",
    );
    expect(
      open([inMarch], archive("e1"), [], false, [{ ...march, closed: false }]),
    ).toBeUndefined();
    // Only the contested entry's period counts.
    const inApril = { ...cement, id: "e3", accrualOn: "2027-04-02" };
    expect(open([inMarch, inApril], archive("e3"), [], false, [march])).toBe(
      undefined,
    );
  });

  it("refuses any new ballot once the final settlement is announced", () => {
    expect(open([cement], archive("e1"), [], true)).toBe(
      "settlement-announced",
    );
  });

  it("refuses a proposal that would leave an account below zero", () => {
    // Archiving the contribution takes 500 out of an account holding 100.
    expect(open([contribution, spentFromAccount], archive("c1"))).toBe(
      "account-overdrawn",
    );
  });

  it("refuses a correction whose new entry would leave an account below zero", () => {
    const tooMuch: EntryBallotRequest = {
      entryId: "e2",
      reason: "Foram R$ 600,00",
      proposal: {
        kind: "correct",
        entry: { type: "expense", amount: 60000n, from: { account: "X" } },
      },
    };
    expect(open([contribution, spentFromAccount], tooMuch)).toBe(
      "account-overdrawn",
    );
  });
});

describe("proposalApplies", () => {
  it("is true when the reversal and the corrected entry can be recorded", () => {
    expect(proposalApplies([cement], weights, "e1", { kind: "archive" })).toBe(
      true,
    );
  });

  it("counts the reversal before the corrected entry", () => {
    // 400 → 450 from an account that held 500: it fits only because the
    // 400 come back first.
    expect(
      proposalApplies([contribution, spentFromAccount], weights, "e2", {
        kind: "correct",
        entry: { type: "expense", amount: 45000n, from: { account: "X" } },
      }),
    ).toBe(true);
  });

  it("is false when applying it would leave an account below zero", () => {
    // Entries made after the ballot opened can make an approval impossible.
    expect(
      proposalApplies([contribution, spentFromAccount], weights, "c1", {
        kind: "archive",
      }),
    ).toBe(false);
    expect(
      proposalApplies([contribution, spentFromAccount], weights, "e2", {
        kind: "correct",
        entry: { type: "expense", amount: 60000n, from: { account: "X" } },
      }),
    ).toBe(false);
  });

  it("lets any other refusal through: it is a bug, not an outcome", () => {
    expect(() =>
      proposalApplies([cement], weights, "nope", { kind: "archive" }),
    ).toThrow(DomainError);
  });
});
