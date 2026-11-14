/** Codes the API turns into responses. Programming errors stay RangeError. */
export type DomainErrorCode =
  | "entry-not-found"
  | "already-reversed"
  | "reversal-of-reversal"
  | "reason-required"
  | "account-overdrawn";

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
