import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeBalances, type Entry } from "./balances.js";

// In draw order: A gets the leftover cent.
const shares = [
  { partnerId: "A", weight: 1 },
  { partnerId: "B", weight: 1 },
  { partnerId: "C", weight: 1 },
];

const balanceOf = (entries: Entry[]) =>
  Object.fromEntries(
    [...computeBalances(entries, shares).partners].map(([id, b]) => [
      id,
      b.balance,
    ]),
  );

describe("computeBalances", () => {
  it("credits the partner who paid an expense from their pocket", () => {
    const entries: Entry[] = [
      { type: "expense", amount: 30000n, from: { partner: "A" } },
    ];
    expect(balanceOf(entries)).toEqual({ A: 20000n, B: -10000n, C: -10000n });
  });

  it("debits the partner who received an income in their pocket", () => {
    const entries: Entry[] = [
      { type: "income", amount: 60000n, to: { partner: "B" } },
    ];
    expect(balanceOf(entries)).toEqual({ A: 20000n, B: -40000n, C: 20000n });
  });

  it("treats goods a partner already had like an expense from their pocket", () => {
    const entries: Entry[] = [
      { type: "in-kind", amount: 30000n, partner: "A" },
    ];
    expect(balanceOf(entries)).toEqual({ A: 20000n, B: -10000n, C: -10000n });
  });

  it("tracks company accounts, which start at zero", () => {
    const entries: Entry[] = [
      { type: "opening", amount: 90000n, partner: "A", account: "X" },
      { type: "contribution", amount: 60000n, partner: "B", account: "X" },
      { type: "expense", amount: 30000n, from: { account: "X" } },
      { type: "transfer", amount: 10000n, fromAccount: "X", toAccount: "Y" },
      { type: "withdrawal", amount: 10000n, account: "X", partner: "A" },
      { type: "reimbursement", amount: 5000n, account: "X", partner: "C" },
    ];
    const { partners, accounts } = computeBalances(entries, shares);
    // Contributions − withdrawals + a third of the −300.00 result.
    expect(balanceOf(entries)).toEqual({ A: 70000n, B: 50000n, C: -15000n });
    expect(partners.get("A")).toEqual({
      contributions: 90000n,
      withdrawals: 10000n,
      share: -10000n,
      balance: 70000n,
    });
    expect(accounts).toEqual(
      new Map([
        ["X", 95000n],
        ["Y", 10000n],
      ]),
    );
  });

  it("rejects an entry for a partner without a share", () => {
    const entries: Entry[] = [
      { type: "expense", amount: 100n, from: { partner: "Z" } },
    ];
    expect(() => computeBalances(entries, shares)).toThrow(RangeError);
  });

  it("cancels an entry with its reversal: same entry, inverted sign", () => {
    const expense: Entry = {
      type: "expense",
      amount: 30000n,
      from: { partner: "A" },
    };
    const entries = [expense, { ...expense, amount: -expense.amount }];
    expect(balanceOf(entries)).toEqual({ A: 0n, B: 0n, C: 0n });
  });

  describe("properties", () => {
    const partner = fc.constantFrom("A", "B", "C");
    const account = fc.constantFrom("X", "Y");
    const party = fc.oneof(
      partner.map((id) => ({ partner: id })),
      account.map((id) => ({ account: id })),
    );
    const amount = fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n });
    const entry: fc.Arbitrary<Entry> = fc.oneof(
      fc.record({ type: fc.constant("expense"), amount, from: party }),
      fc.record({ type: fc.constant("income"), amount, to: party }),
      fc.record({ type: fc.constant("in-kind"), amount, partner }),
      ...(["contribution", "opening"] as const).map((type) =>
        fc.record({ type: fc.constant(type), amount, partner, account }),
      ),
      ...(["withdrawal", "reimbursement"] as const).map((type) =>
        fc.record({ type: fc.constant(type), amount, account, partner }),
      ),
      fc.record({
        type: fc.constant("transfer"),
        amount,
        fromAccount: account,
        toAccount: account,
      }),
    );
    const sum = (values: Iterable<bigint>) =>
      [...values].reduce((a, b) => a + b, 0n);

    it("keeps the golden rule: partners add up to the accounts", () => {
      fc.assert(
        fc.property(fc.array(entry, { maxLength: 30 }), (entries) => {
          const { partners, accounts } = computeBalances(entries, shares);
          const ofPartners = sum([...partners.values()].map((p) => p.balance));
          expect(ofPartners).toBe(sum(accounts.values()));
        }),
      );
    });

    it("returns to zero when every entry is reversed", () => {
      fc.assert(
        fc.property(fc.array(entry, { maxLength: 30 }), (entries) => {
          const reversals = entries.map((e) => ({ ...e, amount: -e.amount }));
          const { result, partners, accounts } = computeBalances(
            [...entries, ...reversals],
            shares,
          );
          expect(result).toBe(0n);
          for (const p of partners.values()) expect(p.balance).toBe(0n);
          for (const a of accounts.values()) expect(a).toBe(0n);
        }),
      );
    });
  });
});
