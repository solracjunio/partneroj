import { describe, expect, it } from "vitest";
import { totalsByCategory } from "./categories.js";
import { createReversal, type LedgerEntry } from "./reversal.js";

const shares = [{ partnerId: "A", weight: 1 }];

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
    const reversal = createReversal([cement, sand], shares, {
      id: "e3",
      originalId: "e1",
      reason: "wrong amount",
    });

    expect(totalsByCategory([cement, sand, reversal])).toEqual(
      new Map([["expense", new Map([["Material", 10000n]])]]),
    );
  });
});
