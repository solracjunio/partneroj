import { describe, expect, it } from "vitest";

import {
  type ExpenseDraft,
  formatDate,
  localDate,
  readDraft,
} from "./expenseForm";

const projectId = "6f1c1b7e-2d3a-4b5c-8d9e-0f1a2b3c4d5e";
const categoryId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const filled: ExpenseDraft = {
  amount: "1.250,50",
  categoryId,
  occurredOn: "2026-11-09",
  description: "  Cimento  ",
};

describe("readDraft", () => {
  it("turns a filled form into the body the API wants", () => {
    expect(readDraft(projectId, filled)).toEqual({
      ok: true,
      body: {
        projectId,
        amountCents: "125050",
        categoryId,
        occurredOn: "2026-11-09",
        description: "Cimento",
      },
    });
  });

  it("leaves out an empty description", () => {
    const result = readDraft(projectId, { ...filled, description: "   " });
    expect(result.ok && result.body).not.toHaveProperty("description");
  });

  it("lists every problem at once, so the partner fixes them in one go", () => {
    expect(
      readDraft(projectId, {
        amount: "12,",
        categoryId: null,
        occurredOn: "",
        description: "x".repeat(201),
      }),
    ).toEqual({
      ok: false,
      problems: ["amount", "category", "date", "description"],
    });
  });

  it("refuses a date that doesn't exist", () => {
    expect(
      readDraft(projectId, { ...filled, occurredOn: "2026-02-30" }),
    ).toEqual({ ok: false, problems: ["date"] });
  });
});

describe("localDate", () => {
  it("uses the phone's own day, not the UTC one", () => {
    // 22:30 on the 9th, local time: already the 10th in UTC for Brazil.
    expect(localDate(new Date(2026, 10, 9, 22, 30))).toBe("2026-11-09");
  });

  it("pads month and day", () => {
    expect(localDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("formatDate", () => {
  it("shows a date the Brazilian way", () => {
    expect(formatDate("2026-11-09")).toBe("09/11/2026");
  });
});
