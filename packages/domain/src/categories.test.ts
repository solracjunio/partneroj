import { describe, expect, it } from "vitest";
import { totalsByCategory } from "./categories.js";
import { createReversal, type LedgerEntry } from "./reversal.js";

const weights = [{ partnerId: "A", weight: 1 }];

describe("totalsByCategory", () => {
  it("cancels a reversed expense in its own category, not as income", () => {
    const cement: LedgerEntry = {
      id: "e1",
      type: "expense",
      amount: 35000n,
      from: { partner: "A" },
      category: "Material",
    };
    const sand: LedgerEntry = { ...cement, id: "e2", amount: 10000n };
    const reversal = createReversal([cement, sand], weights, {
      id: "e3",
      originalId: "e1",
      reason: "wrong amount",
    });

    expect(totalsByCategory([cement, sand, reversal])).toEqual(
      new Map([["expense", new Map([["Material", 10000n]])]]),
    );
  });

  it("totals the entries without a category under an empty name", () => {
    // The key a screen looks for to show "Sem categoria".
    const plain: LedgerEntry = {
      id: "e1",
      type: "expense",
      amount: 5000n,
      from: { partner: "A" },
    };
    const material: LedgerEntry = {
      ...plain,
      id: "e2",
      amount: 7000n,
      category: "Material",
    };
    expect(totalsByCategory([plain, { ...plain, id: "e3" }, material])).toEqual(
      new Map([
        [
          "expense",
          new Map([
            ["", 10000n],
            ["Material", 7000n],
          ]),
        ],
      ]),
    );
  });
});
