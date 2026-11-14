import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeBalances, type Entry } from "./balances.js";
import { fairShares, sameWeights } from "./contributions.js";

// In draw order: A gets the leftover cent.
const equal = [
  { partnerId: "A", weight: 1 },
  { partnerId: "B", weight: 1 },
  { partnerId: "C", weight: 1 },
];

const paid = (partner: string, amount: bigint): Entry => ({
  type: "expense",
  amount,
  from: { partner },
});

const sharesOf = (entries: Entry[], weights = equal) =>
  Object.fromEntries(fairShares(computeBalances(entries, weights), weights));

describe("fairShares", () => {
  it("is the average when the weights are equal, the extra cent by draw", () => {
    // R$ 1,00 put in by A alone: 34 + 33 + 33 cents.
    expect(sharesOf([paid("A", 100n)])).toEqual({ A: 34n, B: 33n, C: 33n });
  });

  it("follows the weights when they differ", () => {
    const weights = [
      { partnerId: "A", weight: 2 },
      { partnerId: "B", weight: 1 },
    ];
    const entries = [paid("A", 10000n), paid("B", 20000n)];
    expect(sharesOf(entries, weights)).toEqual({ A: 20000n, B: 10000n });
  });

  it("counts what each one put in, whoever paid it", () => {
    const entries = [paid("A", 30000n), paid("B", 60000n)];
    expect(sharesOf(entries)).toEqual({ A: 30000n, B: 30000n, C: 30000n });
  });

  it("leaves out an undone expense: its reversal cancels it", () => {
    const entries = [paid("A", 30000n), paid("B", 6000n), paid("B", -6000n)];
    expect(sharesOf(entries)).toEqual({ A: 10000n, B: 10000n, C: 10000n });
  });

  it("is zero for everyone before anything was put in", () => {
    expect(sharesOf([])).toEqual({ A: 0n, B: 0n, C: 0n });
  });

  it("does not count what was paid from a company account", () => {
    const entries: Entry[] = [
      { type: "opening", amount: 90000n, partner: "A", account: "X" },
      { type: "expense", amount: 30000n, from: { account: "X" } },
    ];
    // The opening is A's contribution; the account's expense is not.
    expect(sharesOf(entries)).toEqual({ A: 30000n, B: 30000n, C: 30000n });
  });

  it("always adds up to everything put in, to the cent", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            partner: fc.constantFrom("A", "B", "C"),
            amount: fc.bigInt({ min: 1n, max: 10_000_000n }),
          }),
        ),
        fc.array(fc.integer({ min: 1, max: 5 }), {
          minLength: 3,
          maxLength: 3,
        }),
        (payments, ws) => {
          const weights = ["A", "B", "C"].map((partnerId, i) => ({
            partnerId,
            weight: ws[i]!,
          }));
          const entries = payments.map((p) => paid(p.partner, p.amount));
          const balances = computeBalances(entries, weights);
          const total = [...balances.partners.values()].reduce(
            (sum, b) => sum + b.contributions,
            0n,
          );
          const shares = [...fairShares(balances, weights).values()];
          expect(shares.reduce((sum, s) => sum + s, 0n)).toBe(total);
        },
      ),
    );
  });

  it("never differs by more than one cent between equal weights", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000_000n }), (amount) => {
        const shares = [
          ...fairShares(
            computeBalances([paid("A", amount)], equal),
            equal,
          ).values(),
        ];
        const most = shares.reduce((a, b) => (a > b ? a : b));
        const least = shares.reduce((a, b) => (a < b ? a : b));
        expect(most - least <= 1n).toBe(true);
      }),
    );
  });
});

describe("sameWeights", () => {
  it("is true when every partner weighs the same", () => {
    expect(sameWeights(equal)).toBe(true);
    expect(sameWeights([{ partnerId: "A", weight: 3 }])).toBe(true);
  });

  it("is false when one weighs differently", () => {
    expect(
      sameWeights([
        { partnerId: "A", weight: 1 },
        { partnerId: "B", weight: 1 },
        { partnerId: "C", weight: 2 },
      ]),
    ).toBe(false);
  });
});
