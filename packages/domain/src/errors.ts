/** The codes createReversal can refuse with. */
const reversalErrorCodes = [
  "entry-not-found",
  "already-reversed",
  "reversal-of-reversal",
  "reason-required",
  "account-overdrawn",
  "corrected-by-ballot",
] as const;

export type ReversalErrorCode = (typeof reversalErrorCodes)[number];

/** Codes the API turns into responses. Programming errors stay RangeError. */
export type DomainErrorCode =
  | ReversalErrorCode
  // Only when opening a ballot on an entry.
  | "ballot-open"
  | "already-contested"
  | "settlement-announced";

/**
 * Whether a refusal is one a reversal can get: a caller that only reverses
 * answers these, and treats any other code as a bug.
 */
export function isReversalErrorCode(
  code: DomainErrorCode,
): code is ReversalErrorCode {
  return (reversalErrorCodes as readonly string[]).includes(code);
}

/** A business rule refused the operation. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    // Stryker disable next-line StringLiteral: only the label of a stack trace; callers check instanceof and code.
    this.name = "DomainError";
  }
}
