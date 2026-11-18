import { describe, expect, it } from "vitest";

import { choiceChange, choiceListQuery, newChoice } from "./choices.js";

describe("newChoice", () => {
  it("trims the name", () => {
    expect(newChoice.parse({ name: "  Caixa " })).toEqual({ name: "Caixa" });
  });

  // A brick takes 2 UTF-16 units: the database counts it as 1 character.
  it("accepts 60 characters, as the database counts them", () => {
    const name = "🧱".repeat(60);
    expect(newChoice.parse({ name })).toEqual({ name });
  });

  it.each([
    ["no name", {}],
    ["a blank name", { name: "   " }],
    ["61 characters", { name: "x".repeat(61) }],
    ["a number", { name: 60 }],
  ])("refuses %s", (_, body) => {
    expect(newChoice.safeParse(body).success).toBe(false);
  });
});

describe("choiceChange", () => {
  it("is a new name, trimmed", () => {
    expect(choiceChange.parse({ name: " Cofre " })).toEqual({ name: "Cofre" });
  });

  it.each([true, false])("is archived: %s", (archived) => {
    expect(choiceChange.parse({ archived })).toEqual({ archived });
  });

  // One change per request: one audit row, one possible refusal.
  it.each([
    ["both at once", { name: "Cofre", archived: true }],
    ["nothing", {}],
    ["an unknown field", { archived: true, color: "red" }],
    ["archived as a string", { archived: "true" }],
    ["a blank name", { name: " " }],
  ])("refuses %s", (_, body) => {
    expect(choiceChange.safeParse(body).success).toBe(false);
  });
});

describe("choiceListQuery", () => {
  it("leaves the archived ones out unless asked", () => {
    expect(choiceListQuery.parse({})).toEqual({});
    expect(choiceListQuery.parse({ archived: "include" })).toEqual({
      archived: "include",
    });
  });

  it("refuses anything else", () => {
    expect(choiceListQuery.safeParse({ archived: "true" }).success).toBe(false);
  });
});
