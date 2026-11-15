import { describe, expect, it } from "vitest";
import { isReversalErrorCode } from "./errors.js";

describe("isReversalErrorCode", () => {
  it.each([
    "entry-not-found",
    "already-reversed",
    "reversal-of-reversal",
    "reason-required",
    "account-overdrawn",
    "corrected-by-ballot",
  ] as const)(
    "is true for %s, which createReversal can refuse with",
    (code) => {
      expect(isReversalErrorCode(code)).toBe(true);
    },
  );

  it.each([
    "ballot-open",
    "already-contested",
    "settlement-announced",
  ] as const)(
    "is false for %s, which only opening a ballot refuses with",
    (code) => {
      expect(isReversalErrorCode(code)).toBe(false);
    },
  );
});
