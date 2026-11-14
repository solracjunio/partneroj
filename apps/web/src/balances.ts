// The words of "Saldos" and of the summary on the first screen (plan
// sections 3 and 5). The numbers all come from the API; this only says
// them in plain words.
//
// In the partners' version every entry is a pocket expense, so a balance
// is what one put in minus their part: "colocou mais que a sua parte".
// When incomes and withdrawals come, the balance also counts what one
// received, and these words need another look.
import type { PartnerBalance, ProjectBalances } from "@partneroj/contracts";

import { formatCents } from "./money";

/** "+ R$ 500,00", "− R$ 500,00" or "R$ 0,00": cents may be negative. */
export function signedReais(cents: string): string {
  const negative = cents.startsWith("-");
  const digits = negative ? cents.slice(1) : cents;
  const reais = `R$ ${formatCents(digits)}`;
  if (BigInt(cents) === 0n) return reais;
  return `${negative ? "−" : "+"} ${reais}`;
}

/** What a balance means to whoever has it. */
export function balanceHint(balanceCents: string): string {
  const balance = BigInt(balanceCents);
  if (balance > 0n) return "Você colocou mais que a sua parte.";
  if (balance < 0n) return "Você colocou menos que a sua parte.";
  return "Você está em dia.";
}

/**
 * Everything put in divided by the partners, in whole cents. Shown as
 * "Média de cada um"; it may differ by a cent from one's own part, which
 * carries the extra cent of the split.
 */
export function averageCents(balances: ProjectBalances): string {
  const total = balances.partners.reduce(
    (sum, p) => sum + BigInt(p.contributedCents),
    0n,
  );
  return (total / BigInt(balances.partners.length)).toString();
}

/**
 * What "Você já colocou" is compared with: the average when everyone
 * weighs the same, the partner's own part by weight when not.
 */
export function comparisonFor(
  balances: ProjectBalances,
  partner: PartnerBalance,
): { label: string; cents: string } {
  return balances.sameWeights
    ? { label: "Média de cada um", cents: averageCents(balances) }
    : { label: "Sua parte pela cota", cents: partner.fairShareCents };
}

/** The signed-in member among the partners; a reader has no weight. */
export function partnerOf(
  balances: ProjectBalances,
  memberId: string,
): PartnerBalance | undefined {
  return balances.partners.find((p) => p.memberId === memberId);
}

/** Before the first expense: the summary says so instead of zeros. */
export function nothingPutIn(balances: ProjectBalances): boolean {
  return balances.partners.every((p) => BigInt(p.contributedCents) === 0n);
}
