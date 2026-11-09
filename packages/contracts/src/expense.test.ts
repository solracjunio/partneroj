import { describe, expect, it } from "vitest";

import { newExpense } from "./expense.js";

const valid = {
  projectId: "01a1c25b-7bf8-7cea-b37d-5194960ba97f",
  amountCents: "15000",
  categoryId: "01a1c25b-6e0e-789c-be70-3b6100b2b90e",
  occurredOn: "2027-01-12",
};

describe("newExpense", () => {
  it("accepts an expense and trims the description", () => {
    expect(newExpense.parse({ ...valid, description: "  cimento " })).toEqual({
      ...valid,
      description: "cimento",
    });
  });

  it.each(["0", "-100", "1.50", "15,00", "0150", "1e5", "1234567890123", ""])(
    "refuses the amount %j",
    (amountCents) => {
      expect(newExpense.safeParse({ ...valid, amountCents }).success).toBe(
        false,
      );
    },
  );

  it("refuses the amount as a JSON number", () => {
    expect(newExpense.safeParse({ ...valid, amountCents: 15000 }).success).toBe(
      false,
    );
  });

  it.each(["12/01/2027", "2027-13-01", "2027-02-30", "hoje"])(
    "refuses the date %j",
    (occurredOn) => {
      expect(newExpense.safeParse({ ...valid, occurredOn }).success).toBe(
        false,
      );
    },
  );

  it("refuses a description over 200 characters", () => {
    expect(
      newExpense.safeParse({ ...valid, description: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("has no field for who paid", () => {
    const parsed = newExpense.parse({
      ...valid,
      fromMemberId: valid.projectId,
    });
    expect(parsed).not.toHaveProperty("fromMemberId");
  });
});
