import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatCents, parseReaisToCents } from "./money";

describe("parseReaisToCents", () => {
  it.each([
    ["150", "15000"],
    ["150,00", "15000"],
    ["12,5", "1250"],
    ["12,50", "1250"],
    ["0,99", "99"],
    ["1.250,00", "125000"],
    ["1.250.000,01", "125000001"],
    ["R$ 12,50", "1250"],
    ["  12,50  ", "1250"],
  ])("reads %j with a comma as %s cents", (input, cents) => {
    expect(parseReaisToCents(input)).toBe(cents);
  });

  it.each([
    // A phone keypad with only a dot: one or two digits after it are cents.
    ["12.5", "1250"],
    ["12.50", "1250"],
    // Three digits after a dot group thousands, as in "1.250".
    ["1.250", "125000"],
    ["1.250.000", "125000000"],
  ])("reads %j with a dot as %s cents", (input, cents) => {
    expect(parseReaisToCents(input)).toBe(cents);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12,",
    ",50",
    "12,505",
    "1,250,00",
    "12.5.0",
    "1.25.000",
    "12.5000",
    "1.250.5",
    "-12,50",
    "1e3",
    "12 50",
  ])("refuses %j", (input) => {
    expect(parseReaisToCents(input)).toBeNull();
  });

  it("refuses zero, since an expense is never free", () => {
    expect(parseReaisToCents("0")).toBeNull();
    expect(parseReaisToCents("0,00")).toBeNull();
  });

  it("drops leading zeros, as the contract wants", () => {
    expect(parseReaisToCents("007,50")).toBe("750");
  });

  it("refuses more than 12 digits of cents, the contract's limit", () => {
    expect(parseReaisToCents("9.999.999.999,99")).toBe("999999999999");
    expect(parseReaisToCents("10.000.000.000,00")).toBeNull();
  });
});

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

  it("reads back everything it shows", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 999_999_999_999n }), (n) => {
        const cents = n.toString();
        expect(parseReaisToCents(formatCents(cents))).toBe(cents);
      }),
    );
  });
});
