// Accounts and categories (plan section 8): the partnership's own lists,
// shown as buttons. Entries point at them and never change, so one is
// archived instead of deleted (migration 0016). Who may change them is
// the API's to check (admins only); these functions check that the row
// is the actor's partnership's, and audit every change.
import { computeBalances } from "@partneroj/domain";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import { loadLedger } from "./ledger.js";
import { isUniqueViolation } from "./pg-errors.js";
import { accounts, auditLog, categories, projects } from "./schema.js";

export type ChoiceKind = "account" | "category";

/** An account or category as the buttons and the admin screen show it. */
export interface Choice {
  id: string;
  name: string;
  /** Null while it is on the buttons. */
  archivedAt: Date | null;
}

/** Why a change was refused; the API turns each into a response. */
export type ChoiceRefusal = "not-found" | "name-taken" | "account-not-empty";

export class ChoiceRefused extends Error {
  constructor(readonly reason: ChoiceRefusal) {
    super(reason);
    this.name = "ChoiceRefused";
  }
}

/** The same bound as the checks accounts_name_shape and categories_name_shape. */
export const MAX_CHOICE_NAME_LENGTH = 60;

interface Actor {
  memberId: string;
  partnershipId: string;
}

const tables = { account: accounts, category: categories } as const;

const columns = (kind: ChoiceKind) => {
  const table = tables[kind];
  return { id: table.id, name: table.name, archivedAt: table.archivedAt };
};

/**
 * The name as it is stored: trimmed, from 1 to 60 characters. The API
 * checks the length first; a name that gets here out of bounds is a bug.
 */
function cleanName(name: string): string {
  const clean = name.trim();
  // [...clean] counts characters as char_length does, not UTF-16 units.
  const length = [...clean].length;
  if (length === 0 || length > MAX_CHOICE_NAME_LENGTH) {
    throw new RangeError(
      `a name has 1 to ${MAX_CHOICE_NAME_LENGTH} characters`,
    );
  }
  return clean;
}

/** The partnership's accounts or categories by name; archived ones on request. */
export async function listChoices(
  db: Database,
  partnershipId: string,
  kind: ChoiceKind,
  options: { includeArchived?: boolean } = {},
): Promise<Choice[]> {
  const table = tables[kind];
  return db
    .select(columns(kind))
    .from(table)
    .where(
      and(
        eq(table.partnershipId, partnershipId),
        options.includeArchived === true ? undefined : isNull(table.archivedAt),
      ),
    )
    .orderBy(asc(table.name));
}

/** Adds an account or category to the actor's partnership. */
export async function createChoice(
  db: Database,
  actor: Actor,
  kind: ChoiceKind,
  name: string,
): Promise<Choice> {
  const clean = cleanName(name);
  return refusingTakenNames(db, async (tx) => {
    const [created] = await tx
      .insert(tables[kind])
      .values({ partnershipId: actor.partnershipId, name: clean })
      .returning(columns(kind));
    await tx.insert(auditLog).values({
      actorId: actor.memberId,
      action: `${kind}.create`,
      entityId: created!.id,
      after: { partnershipId: actor.partnershipId, name: clean },
    });
    return created!;
  });
}

/** Renames one; the same name again changes nothing and isn't audited. */
export async function renameChoice(
  db: Database,
  actor: Actor,
  kind: ChoiceKind,
  id: string,
  name: string,
): Promise<Choice> {
  const clean = cleanName(name);
  return refusingTakenNames(db, async (tx) => {
    const current = await lockOwn(tx, actor, kind, id);
    if (current.name === clean) return current;
    const changed = await update(tx, kind, id, { name: clean });
    await tx.insert(auditLog).values({
      actorId: actor.memberId,
      action: `${kind}.rename`,
      entityId: id,
      before: { name: current.name },
      after: { name: clean },
    });
    return changed;
  });
}

/**
 * Takes one off the buttons. An account must hold no money first: the
 * money in it always has an owner (ADR 0007), and an archived account
 * would hide it. Archiving it again keeps the first moment.
 */
export async function archiveChoice(
  db: Database,
  actor: Actor,
  kind: ChoiceKind,
  id: string,
): Promise<Choice> {
  return db.transaction(async (tx) => {
    const current = await lockOwn(tx, actor, kind, id);
    if (current.archivedAt !== null) return current;
    // A category is never a side of an entry, so its "balance" is always
    // zero: asking only for an account saves loading every ledger.
    if (kind === "account" && (await accountBalance(tx, actor, id)) !== 0n) {
      throw new ChoiceRefused("account-not-empty");
    }
    const changed = await update(tx, kind, id, { archivedAt: new Date() });
    await auditArchive(tx, actor, kind, current, changed);
    return changed;
  });
}

/** Puts one back on the buttons. */
export async function restoreChoice(
  db: Database,
  actor: Actor,
  kind: ChoiceKind,
  id: string,
): Promise<Choice> {
  return db.transaction(async (tx) => {
    const current = await lockOwn(tx, actor, kind, id);
    if (current.archivedAt === null) return current;
    const changed = await update(tx, kind, id, { archivedAt: null });
    await auditArchive(tx, actor, kind, current, changed);
    return changed;
  });
}

/**
 * Runs a change in a transaction and turns the unique constraint on the
 * name into a refusal. Two requests with the same name at once both pass
 * any check made before the insert; the constraint lets only one in.
 */
async function refusingTakenNames<T>(
  db: Database,
  change: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(change);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ChoiceRefused("name-taken");
    throw error;
  }
}

/**
 * The row, if it is the actor's partnership's, locked until the change
 * commits: two changes at once are applied one after the other, so each
 * audit row's "before" is what the other left.
 */
async function lockOwn(
  tx: Transaction,
  actor: Actor,
  kind: ChoiceKind,
  id: string,
): Promise<Choice> {
  const table = tables[kind];
  const [found] = await tx
    .select(columns(kind))
    .from(table)
    .where(and(eq(table.id, id), eq(table.partnershipId, actor.partnershipId)))
    .for("update");
  if (found === undefined) throw new ChoiceRefused("not-found");
  return found;
}

async function update(
  tx: Transaction,
  kind: ChoiceKind,
  id: string,
  set: { name: string } | { archivedAt: Date | null },
): Promise<Choice> {
  const table = tables[kind];
  const [changed] = await tx
    .update(table)
    .set(set)
    .where(eq(table.id, id))
    .returning(columns(kind));
  return changed!;
}

async function auditArchive(
  tx: Transaction,
  actor: Actor,
  kind: ChoiceKind,
  before: Choice,
  after: Choice,
): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: actor.memberId,
    action: `${kind}.${after.archivedAt === null ? "restore" : "archive"}`,
    entityId: after.id,
    before: { archivedAt: before.archivedAt },
    after: { archivedAt: after.archivedAt },
  });
}

/**
 * The account's balance over every project of the partnership: an
 * account is the partnership's, and money put in during one project may
 * still be there in the next. The domain computes it, as on "Saldos".
 */
async function accountBalance(
  tx: Transaction,
  actor: Actor,
  accountId: string,
): Promise<bigint> {
  // Only the partnership's projects: its entries name only its accounts
  // (each write checks it), so another partnership's ledger adds nothing
  // here but the time to load it.
  const partnershipProjects = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.partnershipId, actor.partnershipId));
  let balance = 0n;
  for (const project of partnershipProjects) {
    const ledger = await loadLedger(tx, project.id);
    const { accounts: held } = computeBalances(ledger.entries, ledger.weights);
    balance += held.get(accountId) ?? 0n;
  }
  return balance;
}

/**
 * Whether none of these accounts is archived, read under a shared lock
 * held until the caller commits: money must not move through an archived
 * account. An archive in flight holds the row (archiveChoice), so this
 * waits for it and sees it; and an archive that comes after waits for the
 * caller's entry, and then counts it in the balance.
 *
 * Every row is locked and then checked here, not filtered by archived_at
 * in the query: a row a WHERE leaves out is neither locked nor waited for.
 */
export async function accountsActive(
  tx: Transaction,
  ids: readonly (string | null)[],
): Promise<boolean> {
  const present = ids.filter((id): id is string => id !== null);
  // A pocket expense names no account: no query (with none, it would
  // find no rows, and the answer would be the same).
  if (present.length === 0) return true;
  const rows = await tx
    .select({ archivedAt: accounts.archivedAt })
    .from(accounts)
    .where(inArray(accounts.id, present))
    .for("share");
  return rows.every((r) => r.archivedAt === null);
}
