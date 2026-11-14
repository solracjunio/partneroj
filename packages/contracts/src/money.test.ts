import { describe, expect, it } from "vitest";

import { formatCents } from "./money.js";

describe("formatCents", () => {
  it.each([
    ["1", "0,01"],
    ["99", "0,99"],
    ["1250", "12,50"],
    ["125000", "1.250,00"],
    ["999999999999", "9.999.999.999,99"],
  ])("shows %s cents as %j", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});
