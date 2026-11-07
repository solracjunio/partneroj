import { describe, expect, it } from "vitest";
import { DomainError, type DomainErrorCode } from "./errors.js";
import {
  assertCanRecord,
  createReversal,
  statusOf,
  type LedgerEntry,
} from "./reversal.js";

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

function refusal(action: () => unknown): DomainErrorCode | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe("createReversal", () => {
  it("keeps the type and category and inverts the sign", () => {
    const reversal = createReversal([cement], weights, {
      id: "e2",
      originalId: "e1",
      reason: "  typed the wrong amount ",
    });
    expect(reversal).toEqual({
      id: "e2",
      type: "expense",
      amount: -35000n,
      from: { partner: "A" },
      category: "Material",
      reversalOf: "e1",
      reason: "typed the wrong amount",
    });
  });

  it.each(["", "   "])("refuses a reversal without a reason (%j)", (reason) => {
    expect(
      refusal(() =>
        createReversal([cement], weights, {
          id: "e2",
          originalId: "e1",
          reason,
        }),
      ),
    ).toBe("reason-required");
  });

  it("refuses to reverse an entry that does not exist", () => {
    expect(
      refusal(() =>
        createReversal([cement], weights, {
          id: "e2",
          originalId: "nope",
          reason: "duplicate",
        }),
      ),
    ).toBe("entry-not-found");
  });

  describe("after a first reversal", () => {
    const first = createReversal([cement], weights, {
      id: "e2",
      originalId: "e1",
      reason: "duplicate",
    });
    const ledger = [cement, first];

    it("refuses to reverse the same entry twice", () => {
      expect(
        refusal(() =>
          createReversal(ledger, weights, {
            id: "e3",
            originalId: "e1",
            reason: "again",
          }),
        ),
      ).toBe("already-reversed");
    });

    it("refuses to reverse a reversal", () => {
      expect(
        refusal(() =>
          createReversal(ledger, weights, {
            id: "e3",
            originalId: "e2",
            reason: "undo the undo",
          }),
        ),
      ).toBe("reversal-of-reversal");
    });
  });

  it("refuses a reversal that would leave an account below zero", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "o1",
        type: "opening",
        amount: 100000n,
        partner: "A",
        account: "X",
      },
      { id: "e1", type: "expense", amount: 80000n, from: { account: "X" } },
    ];
    expect(
      refusal(() =>
        createReversal(ledger, weights, {
          id: "e2",
          originalId: "o1",
          reason: "wrong account",
        }),
      ),
    ).toBe("account-overdrawn");
  });
});

describe("assertCanRecord", () => {
  const opened: LedgerEntry[] = [
    { id: "o1", type: "opening", amount: 20000n, partner: "A", account: "X" },
  ];
  const spend = (amount: bigint) =>
    refusal(() =>
      assertCanRecord(opened, weights, {
        type: "expense",
        amount,
        from: { account: "X" },
      }),
    );

  it("allows an expense that empties the account exactly", () => {
    expect(spend(20000n)).toBeUndefined();
  });

  it("refuses an expense larger than the account balance", () => {
    expect(spend(20001n)).toBe("account-overdrawn");
  });
});

describe("statusOf", () => {
  const reversal = createReversal([cement], weights, {
    id: "e2",
    originalId: "e1",
    reason: "duplicate",
  });

  it.each([
    ["confirmed", [cement], []],
    ["in-vote", [cement], ["e1"]],
    ["reversed", [cement, reversal], []],
    // The author reversed it during the vote, which then closes with no effect.
    ["reversed", [cement, reversal], ["e1"]],
  ] as const)("is %s", (expected, ledger, openVotes) => {
    expect(statusOf(ledger, "e1", new Set(openVotes))).toBe(expected);
  });
});
