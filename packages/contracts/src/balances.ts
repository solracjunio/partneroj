// "Saldos" and "Quanto cada um já colocou" (plan sections 3 and 5). All
// amounts are cents as strings (ADR 0005), and may be negative.

/** One partner of the project, in its draw order. */
export interface PartnerBalance {
  memberId: string;
  name: string;
  weight: number;
  /** What they put in: pocket expenses, contributions, openings. */
  contributedCents: string;
  /** What came back to them: withdrawals, reimbursements. */
  withdrawnCents: string;
  /** Their part of the result (income − expenses), by weight. */
  resultPartCents: string;
  /** Positive: they put in more than their part, and get it back. */
  balanceCents: string;
  /** Their part of everything put in, by weight: the average if equal. */
  fairShareCents: string;
}

export interface ProjectBalances {
  project: { id: string; name: string };
  /** Every partner weighs the same: the comparison is the "média". */
  sameWeights: boolean;
  resultCents: string;
  partners: PartnerBalance[];
  /** The partnership's accounts; empty without a shared account. */
  accounts: { id: string; name: string; balanceCents: string }[];
}
