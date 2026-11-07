import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { splitByWeights } from "./split.js";

// Weights are listed in the project's draw order: on a tie, the earlier wins.
const equalThree = [
  { partnerId: "A", weight: 1 },
  { partnerId: "B", weight: 1 },
  { partnerId: "C", weight: 1 },
];

describe("splitByWeights", () => {
  it("gives the leftover cent to the first in draw order when weights are equal", () => {
    expect(splitByWeights(10000n, equalThree)).toEqual(
      new Map([
        ["A", 3334n],
        ["B", 3333n],
        ["C", 3333n],
      ]),
    );
  });

  it("gives the leftover cent to the largest remainder before the draw order", () => {
    const weights = [
      { partnerId: "A", weight: 2 },
      { partnerId: "B", weight: 3 },
    ];
    expect(splitByWeights(1n, weights)).toEqual(
      new Map([
        ["A", 0n],
        ["B", 1n],
      ]),
    );
  });

  it("makes the first in draw order pay the extra cent when the amount is negative", () => {
    expect(splitByWeights(-10000n, equalThree)).toEqual(
      new Map([
        ["A", -3334n],
        ["B", -3333n],
        ["C", -3333n],
      ]),
    );
  });

  it.each([
    [2n, [1n, 1n, 0n]],
    [12000000n, [4000000n, 4000000n, 4000000n]],
  ])("splits %i cents by 1:1:1 as in ADR 0002", (amount, expected) => {
    expect([...splitByWeights(amount, equalThree).values()]).toEqual(expected);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects a weight of %d", (weight) => {
    expect(() => splitByWeights(100n, [{ partnerId: "A", weight }])).toThrow(
      RangeError,
    );
  });

  it("rejects an empty list of weights", () => {
    expect(() => splitByWeights(100n, [])).toThrow(RangeError);
  });

  it("rejects a partner listed twice", () => {
    const twice = [
      { partnerId: "A", weight: 1 },
      { partnerId: "A", weight: 1 },
    ];
    expect(() => splitByWeights(100n, twice)).toThrow(RangeError);
  });

  describe("properties", () => {
    const amounts = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
    const weights = fc.array(fc.integer({ min: 1, max: 100 }), {
      minLength: 1,
      maxLength: 8,
    });
    const toWeights = (ws: number[]) =>
      ws.map((weight, i) => ({ partnerId: `p${i}`, weight }));

    it("always sums exactly to the amount", () => {
      fc.assert(
        fc.property(amounts, weights, (amount, ws) => {
          const parts = [...splitByWeights(amount, toWeights(ws)).values()];
          expect(parts.reduce((a, b) => a + b, 0n)).toBe(amount);
        }),
      );
    });

    it("never gives equal weights parts more than 1 cent apart", () => {
      const sameWeight = fc.tuple(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 8 }),
      );
      fc.assert(
        fc.property(amounts, sameWeight, (amount, [weight, count]) => {
          const parts = [
            ...splitByWeights(
              amount,
              toWeights(Array<number>(count).fill(weight)),
            ).values(),
          ];
          const max = parts.reduce((a, b) => (a > b ? a : b));
          const min = parts.reduce((a, b) => (a < b ? a : b));
          expect(max - min <= 1n).toBe(true);
        }),
      );
    });

    it("keeps every part less than 1 cent from its exact part", () => {
      fc.assert(
        fc.property(amounts, weights, (amount, ws) => {
          const total = BigInt(ws.reduce((a, b) => a + b, 0));
          const parts = [...splitByWeights(amount, toWeights(ws)).values()];
          parts.forEach((part, i) => {
            // |part - amount*w/total| < 1  <=>  |part*total - amount*w| < total
            const gap = part * total - amount * BigInt(ws[i]!);
            expect((gap < 0n ? -gap : gap) < total).toBe(true);
          });
        }),
      );
    });
  });
});
