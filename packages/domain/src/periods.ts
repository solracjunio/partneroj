// Accrual periods (plan section 3, "Imutabilidade, estorno e períodos"):
// an ongoing business is settled period by period, and once a period is
// closed, its entries are locked. A construction has no periods; it is
// settled once, at the end.
import { DomainError } from "./errors.js";

/** Days as "YYYY-MM-DD", both ends included. */
export interface Period {
  startsOn: string;
  endsOn: string;
  closed: boolean;
}

/**
 * Refuses a date that falls in a closed period: what was settled there
 * never changes, and a correction goes into a later period. The dates are
 * ISO days, so comparing the text compares the days.
 */
export function assertPeriodOpen(
  accrualOn: string,
  periods: readonly Period[],
): void {
  const closed = periods.find(
    (p) => p.closed && p.startsOn <= accrualOn && accrualOn <= p.endsOn,
  );
  if (closed)
    throw new DomainError(
      "period-closed",
      `${accrualOn} is in the period closed from ${closed.startsOn} to ${closed.endsOn}`,
    );
}
