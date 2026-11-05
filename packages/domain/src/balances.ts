// Balance formula and golden rule (plan section 3, "O acerto").
import { splitByWeights, type Share } from "./split.js";

/** Who is on one side of an entry: a partner's pocket or a company account. */
export type Party = { partner: string } | { account: string };

/**
 * One entry per money flow of the plan. Amounts are in cents and positive;
 * a reversal is the same entry with the sign inverted.
 */
export type Entry =
  | { type: "expense"; amount: bigint; from: Party }
  | { type: "income"; amount: bigint; to: Party }
  | { type: "contribution"; amount: bigint; partner: string; account: string }
  | { type: "in-kind"; amount: bigint; partner: string }
  | { type: "withdrawal"; amount: bigint; account: string; partner: string }
  | { type: "reimbursement"; amount: bigint; account: string; partner: string }
  | { type: "transfer"; amount: bigint; fromAccount: string; toAccount: string }
  | { type: "opening"; amount: bigint; partner: string; account: string };

export interface PartnerBalance {
  contributions: bigint;
  withdrawals: bigint;
  /** This partner's part of the result, by weight. */
  share: bigint;
  balance: bigint;
}

export interface Balances {
  result: bigint;
  partners: Map<string, PartnerBalance>;
  accounts: Map<string, bigint>;
}

export function computeBalances(
  entries: readonly Entry[],
  shares: readonly Share[],
): Balances {
  const contributions = new Map(shares.map((s) => [s.partnerId, 0n]));
  const withdrawals = new Map(shares.map((s) => [s.partnerId, 0n]));
  const accounts = new Map<string, bigint>();
  let result = 0n;

  // Money leaving or entering a party: pockets count as contributions and
  // withdrawals, accounts just move their balance.
  const paidBy = (party: Party, amount: bigint) =>
    "partner" in party
      ? addToPartner(contributions, party.partner, amount)
      : add(accounts, party.account, -amount);
  const receivedBy = (party: Party, amount: bigint) =>
    "partner" in party
      ? addToPartner(withdrawals, party.partner, amount)
      : add(accounts, party.account, amount);

  for (const entry of entries) {
    switch (entry.type) {
      case "expense":
        result -= entry.amount;
        paidBy(entry.from, entry.amount);
        break;
      case "in-kind":
        result -= entry.amount;
        paidBy({ partner: entry.partner }, entry.amount);
        break;
      case "income":
        result += entry.amount;
        receivedBy(entry.to, entry.amount);
        break;
      case "contribution":
      case "opening":
        paidBy({ partner: entry.partner }, entry.amount);
        receivedBy({ account: entry.account }, entry.amount);
        break;
      case "withdrawal":
      case "reimbursement":
        paidBy({ account: entry.account }, entry.amount);
        receivedBy({ partner: entry.partner }, entry.amount);
        break;
      case "transfer":
        paidBy({ account: entry.fromAccount }, entry.amount);
        receivedBy({ account: entry.toAccount }, entry.amount);
        break;
      default:
        entry satisfies never;
    }
  }

  const split = splitByWeights(result, shares);
  const partners = new Map(
    shares.map(({ partnerId: id }) => {
      const c = contributions.get(id)!;
      const w = withdrawals.get(id)!;
      const share = split.get(id)!;
      return [
        id,
        { contributions: c, withdrawals: w, share, balance: c - w + share },
      ];
    }),
  );
  return { result, partners, accounts };
}

function add(totals: Map<string, bigint>, id: string, amount: bigint): void {
  totals.set(id, (totals.get(id) ?? 0n) + amount);
}

/** Partners come from the shares; an unknown one would vanish from the sums. */
function addToPartner(
  totals: Map<string, bigint>,
  id: string,
  amount: bigint,
): void {
  if (!totals.has(id)) throw new RangeError(`Partner ${id} has no share`);
  add(totals, id, amount);
}
