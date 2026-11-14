// "Saldos" and "Quanto cada um já colocou" (plan sections 3 and 5): the
// current project's balances, computed by the domain from the whole
// ledger every time. Nothing is stored: the entries are the truth.
import { computeBalances, fairShares, sameWeights } from "@partneroj/domain";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { newestProject } from "./expenses.js";
import { loadLedger } from "./ledger.js";
import { accounts, members } from "./schema.js";

export interface PartnerBalanceRow {
  memberId: string;
  name: string;
  weight: number;
  /** All cents: put in, taken out, part of the result, and the balance. */
  contributions: bigint;
  withdrawals: bigint;
  resultPart: bigint;
  balance: bigint;
  /** Their part of everything put in, by weight: the average when equal. */
  fairShare: bigint;
}

export interface ProjectBalances {
  project: { id: string; name: string };
  /** Every partner weighs the same: the screen says "média". */
  sameWeights: boolean;
  result: bigint;
  /** In the project's draw order. */
  partners: PartnerBalanceRow[];
  /** The partnership's accounts, by name, with their balance. */
  accounts: { id: string; name: string; balance: bigint }[];
}

/**
 * The balances of the partnership's current project, or null when it has
 * no project yet. Only that partnership's project is read: the partnership
 * comes from the session.
 */
export async function projectBalances(
  db: Database,
  partnershipId: string,
): Promise<ProjectBalances | null> {
  const project = await newestProject(db, partnershipId);
  if (project === null) return null;

  const ledger = await loadLedger(db, project.id);
  const balances = computeBalances(ledger.entries, ledger.weights);
  const shares = fairShares(balances, ledger.weights);

  const ids = ledger.weights.map((w) => w.partnerId);
  const names = new Map(
    (
      await db
        .select({ id: members.id, name: members.name })
        .from(members)
        .where(inArray(members.id, ids))
    ).map((m) => [m.id, m.name]),
  );
  const partnershipAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.partnershipId, partnershipId))
    .orderBy(accounts.name);

  return {
    project,
    sameWeights: sameWeights(ledger.weights),
    result: balances.result,
    partners: ledger.weights.map(({ partnerId, weight }) => ({
      memberId: partnerId,
      name: names.get(partnerId)!,
      weight,
      ...balances.partners.get(partnerId)!,
      fairShare: shares.get(partnerId)!,
    })),
    accounts: partnershipAccounts.map((a) => ({
      ...a,
      balance: balances.accounts.get(a.id) ?? 0n,
    })),
  };
}
