import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeBalances, type Entry, type Party } from "./balances.js";
import {
  EXACT_SEARCH_LIMIT,
  greedyTransfers,
  settle,
  settlementParticipants,
  type Participant,
  type Transfer,
} from "./settlement.js";

const weights = [
  { partnerId: "A", weight: 1 },
  { partnerId: "B", weight: 1 },
  { partnerId: "C", weight: 1 },
];

const key = (party: Party) =>
  "partner" in party ? `partner:${party.partner}` : `account:${party.account}`;

/** Everyone's balance after the transfers are paid: all zero when settled. */
function afterPaying(
  participants: readonly Participant[],
  transfers: readonly Transfer[],
): Map<string, bigint> {
  const left = new Map(participants.map((p) => [key(p.party), p.balance]));
  for (const t of transfers) {
    // Paying moves a debtor up to zero and a creditor down to zero.
    left.set(key(t.from), left.get(key(t.from))! + t.amount);
    left.set(key(t.to), left.get(key(t.to))! - t.amount);
  }
  return left;
}

const partner = (id: string, balance: bigint): Participant => ({
  party: { partner: id },
  balance,
});

// Any balances that add up to zero, with up to 3 accounts holding cash.
const zeroSum = fc
  .tuple(
    fc.array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), {
      minLength: 1,
      maxLength: 9,
    }),
    fc.array(fc.bigInt({ min: 0n, max: 1_000_000n }), { maxLength: 3 }),
  )
  .map(([partners, accounts]) => {
    const list: Participant[] = [
      ...partners.map((b, i) => partner(`P${i}`, b)),
      ...accounts.map((held, i) => ({
        party: { account: `X${i}` },
        balance: -held,
      })),
    ];
    // The first partner takes what makes the sum zero.
    const sum = list.reduce((s, p) => s + p.balance, 0n);
    list[0] = partner("P0", list[0]!.balance - sum);
    return list;
  });

describe("settlementParticipants", () => {
  it("has only the partners when there is no common account", () => {
    const entries: Entry[] = [
      { type: "expense", amount: 30000n, from: { partner: "A" } },
    ];
    expect(settlementParticipants(computeBalances(entries, weights))).toEqual([
      partner("A", 20000n),
      partner("B", -10000n),
      partner("C", -10000n),
    ]);
  });

  it("adds each account as a participant owing what it holds", () => {
    // B put 900 in the account and nothing was spent: the account pays it back.
    const entries: Entry[] = [
      { type: "contribution", amount: 90000n, partner: "B", account: "X" },
    ];
    expect(settlementParticipants(computeBalances(entries, weights))).toEqual([
      partner("A", 0n),
      partner("B", 90000n),
      partner("C", 0n),
      { party: { account: "X" }, balance: -90000n },
    ]);
  });
});

describe("greedyTransfers", () => {
  it("has the largest debtor pay the largest creditor, as Pix between partners", () => {
    const transfers = greedyTransfers([
      partner("A", 20000n),
      partner("B", -10000n),
      partner("C", -10000n),
    ]);
    expect(transfers).toEqual([
      {
        from: { partner: "B" },
        to: { partner: "A" },
        amount: 10000n,
        kind: "pix",
      },
      {
        from: { partner: "C" },
        to: { partner: "A" },
        amount: 10000n,
        kind: "pix",
      },
    ]);
  });

  it("turns money left in an account into a suggested withdrawal", () => {
    const transfers = greedyTransfers([
      partner("A", 0n),
      partner("B", 90000n),
      partner("C", 0n),
      { party: { account: "X" }, balance: -90000n },
    ]);
    expect(transfers).toEqual([
      {
        from: { account: "X" },
        to: { partner: "B" },
        amount: 90000n,
        kind: "withdrawal",
      },
    ]);
  });

  it("needs no transfer with nobody to settle", () => {
    expect(greedyTransfers([])).toEqual([]);
  });

  it("needs no transfer when everyone is already even", () => {
    expect(greedyTransfers([partner("A", 0n), partner("B", 0n)])).toEqual([]);
  });

  it("breaks ties by the participants' order, so the same input gives the same transfers", () => {
    const transfers = greedyTransfers([
      partner("A", 100n),
      partner("B", 100n),
      partner("C", -100n),
      partner("D", -100n),
    ]);
    expect(transfers).toEqual([
      {
        from: { partner: "C" },
        to: { partner: "A" },
        amount: 100n,
        kind: "pix",
      },
      {
        from: { partner: "D" },
        to: { partner: "B" },
        amount: 100n,
        kind: "pix",
      },
    ]);
  });

  it("refuses balances that don't add up to zero", () => {
    // The golden rule broke somewhere: settling would hide it.
    expect(() =>
      greedyTransfers([partner("A", 100n), partner("B", -99n)]),
    ).toThrow(new RangeError("Balances add up to 1, not zero"));
  });

  it("refuses an account that would receive money", () => {
    // An account never goes negative, so as a participant it never has a
    // positive balance; one that does is a bug upstream.
    expect(() =>
      greedyTransfers([
        partner("A", -100n),
        { party: { account: "X" }, balance: 100n },
      ]),
    ).toThrow(new RangeError("Account X can't receive money"));
  });

  it("always settles everyone to zero", () => {
    fc.assert(
      fc.property(zeroSum, (participants) => {
        const left = afterPaying(participants, greedyTransfers(participants));
        expect([...left.values()].every((b) => b === 0n)).toBe(true);
      }),
    );
  });

  it("never needs more than one transfer less than the people who aren't even", () => {
    fc.assert(
      fc.property(zeroSum, (participants) => {
        const uneven = participants.filter((p) => p.balance !== 0n).length;
        expect(greedyTransfers(participants).length).toBeLessThanOrEqual(
          Math.max(uneven - 1, 0),
        );
      }),
    );
  });

  it("only moves positive amounts, from a debtor to a creditor, never to an account", () => {
    fc.assert(
      fc.property(zeroSum, (participants) => {
        const balance = new Map(
          participants.map((p) => [key(p.party), p.balance]),
        );
        for (const t of greedyTransfers(participants)) {
          expect(t.amount).toBeGreaterThan(0n);
          expect(balance.get(key(t.from))).toBeLessThan(0n);
          expect(balance.get(key(t.to))).toBeGreaterThan(0n);
          expect("partner" in t.to).toBe(true);
          expect(t.kind).toBe("partner" in t.from ? "pix" : "withdrawal");
        }
      }),
    );
  });
});

/**
 * The most zero-sum groups the balances split into, by a different method
 * than the implementation's (a DP over bitmasks, one person at a time):
 * the oracle for "fewest transfers = people who aren't even − groups".
 */
function mostZeroSumGroups(balances: readonly bigint[]): number {
  const b = balances.filter((v) => v !== 0n);
  const full = (1 << b.length) - 1;
  const sum: bigint[] = [0n];
  const best: number[] = [0];
  for (let mask = 1; mask <= full; mask++) {
    const low = 31 - Math.clz32(mask & -mask);
    sum[mask] = sum[mask & (mask - 1)]! + b[low]!;
    let most = 0;
    for (let i = 0; i < b.length; i++) {
      if (mask & (1 << i)) most = Math.max(most, best[mask ^ (1 << i)]!);
    }
    best[mask] = most + (sum[mask] === 0n ? 1 : 0);
  }
  return best[full]!;
}

// ADR 0009's case, in cents: B and E alone add up to zero.
const greedyMisses = [
  partner("A", -90000n),
  partner("B", -80000n),
  partner("C", 20000n),
  partner("D", 70000n),
  partner("E", 80000n),
];

describe("settle", () => {
  it("finds the fewest transfers where the greedy makes one too many", () => {
    expect(greedyTransfers(greedyMisses)).toHaveLength(4);
    // A pays C and D (one group), B pays E (the other).
    expect(settle(greedyMisses)).toEqual([
      {
        from: { partner: "A" },
        to: { partner: "D" },
        amount: 70000n,
        kind: "pix",
      },
      {
        from: { partner: "A" },
        to: { partner: "C" },
        amount: 20000n,
        kind: "pix",
      },
      {
        from: { partner: "B" },
        to: { partner: "E" },
        amount: 80000n,
        kind: "pix",
      },
    ]);
  });

  it("compares the splits instead of keeping the first group it finds", () => {
    // {3, −1, −2} is a zero-sum group, but taking it leaves {1, 2, −3}
    // as one more: 2 groups, 4 transfers. Pairs make 3 groups, 3 transfers.
    const pairs = [
      partner("A", 3n),
      partner("B", -1n),
      partner("C", -2n),
      partner("D", 1n),
      partner("E", 2n),
      partner("F", -3n),
    ];
    expect(settle(pairs)).toEqual([
      { from: { partner: "F" }, to: { partner: "A" }, amount: 3n, kind: "pix" },
      { from: { partner: "B" }, to: { partner: "D" }, amount: 1n, kind: "pix" },
      { from: { partner: "C" }, to: { partner: "E" }, amount: 2n, kind: "pix" },
    ]);
  });

  it("leaves out whoever is already even", () => {
    const withEven = [partner("Z", 0n), ...greedyMisses, partner("Y", 0n)];
    expect(settle(withEven)).toEqual(settle(greedyMisses));
  });

  it(`uses the greedy alone above ${EXACT_SEARCH_LIMIT} people who aren't even`, () => {
    // Four more pairs that each add up to zero: 9 people, over the limit.
    const nine = [
      ...greedyMisses,
      partner("F", 3n),
      partner("G", -3n),
      partner("H", 5n),
      partner("I", -5n),
    ];
    expect(EXACT_SEARCH_LIMIT).toBe(8);
    expect(settle(nine)).toEqual(greedyTransfers(nine));
    // Exactly at the limit, the search still runs: 8 people, three groups.
    const eight = [
      ...greedyMisses,
      partner("F", 3n),
      partner("G", 2n),
      partner("H", -5n),
    ];
    expect(settle(eight)).toHaveLength(5);
    // Whoever is already even doesn't count toward the limit.
    expect(settle([...eight, partner("Z", 0n)])).toHaveLength(5);
    expect(greedyTransfers(eight).length).toBeGreaterThan(5);
  });

  it("refuses what the greedy refuses", () => {
    expect(() => settle([partner("A", 1n)])).toThrow(
      new RangeError("Balances add up to 1, not zero"),
    );
    expect(() =>
      settle([partner("A", -1n), { party: { account: "X" }, balance: 1n }]),
    ).toThrow(new RangeError("Account X can't receive money"));
  });

  // Small amounts make zero-sum groups common, which is where it matters.
  const smallZeroSum = fc
    .array(fc.bigInt({ min: -9n, max: 9n }), { minLength: 1, maxLength: 8 })
    .map((values) => {
      const list = values.map((b, i) => partner(`P${i}`, b));
      const sum = list.reduce((s, p) => s + p.balance, 0n);
      list[0] = partner("P0", list[0]!.balance - sum);
      return list;
    });

  it("makes the fewest transfers possible, up to the limit", () => {
    fc.assert(
      fc.property(smallZeroSum, (participants) => {
        const balances = participants.map((p) => p.balance);
        const uneven = balances.filter((b) => b !== 0n).length;
        expect(settle(participants)).toHaveLength(
          uneven - mostZeroSumGroups(balances),
        );
      }),
    );
  });

  it("always settles everyone to zero, never with more transfers than the greedy", () => {
    fc.assert(
      fc.property(fc.oneof(zeroSum, smallZeroSum), (participants) => {
        const transfers = settle(participants);
        const left = afterPaying(participants, transfers);
        expect([...left.values()].every((b) => b === 0n)).toBe(true);
        expect(transfers.length).toBeLessThanOrEqual(
          greedyTransfers(participants).length,
        );
        for (const t of transfers) expect(t.amount).toBeGreaterThan(0n);
      }),
    );
  });
});
