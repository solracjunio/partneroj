// The admin-cli commands (docs/operacao.md), apart from the process that
// runs them, so the tests call them on a real database: the first
// partnership and its first invites, and the emergency procedure. Each
// change is audited with a null actor, which is how the audit tells a
// server command from a member.
import { parseArgs } from "node:util";
import type { PgBoss } from "pg-boss";
import type { Database } from "./client.js";
import { createEmergencyInvite } from "./emergency-invites.js";
import { createInvite } from "./invites.js";
import {
  createPartnership,
  listMembers,
  setEntryBallotRule,
  type EntryBallotRule,
  type NewMember,
} from "./partnerships.js";
import {
  addCategories,
  createProject,
  listProjects,
  type NewWeight,
} from "./projects.js";

export interface AdminOutput {
  /** The site's address, for invite links. */
  publicUrl: string | undefined;
  /** Where each line of the answer goes: the console, or a test's array. */
  print: (line: string) => void;
  /** Open the send-only queue connection when an emergency invite needs it. */
  startQueue: () => Promise<PgBoss>;
}

export const adminUsage = `Usage:
  admin-cli create-partnership --name <name> --admin <name> --admin <name>
                               [--partner <name>]... [--reader <name>]...
                               [--ballot-rule majority|unanimity]
  admin-cli set-ballot-rule <partnership id> majority|unanimity
  admin-cli list-members
  admin-cli invite <member id>
  admin-cli emergency-invite --partnership <id> --name <name>
  admin-cli create-project --partnership <id> --name <name> --starts-on <YYYY-MM-DD>
                           [--kind construction|ongoing] --weight <member id>=<n>...
  admin-cli list-projects
  admin-cli add-categories --partnership <id> --name <name>...`;

/**
 * A command gets what is after its name. Commands without options take
 * only the first two: a function with fewer parameters fits this type.
 */
type AdminCommand = (
  db: Database,
  output: AdminOutput,
  args: string[],
) => Promise<void>;

/** The rule given on the command line, or the usage when missing or unknown. */
function ballotRule(value: string | undefined): EntryBallotRule {
  if (value !== "majority" && value !== "unanimity") {
    throw new Error(adminUsage);
  }
  return value;
}

/** Creates a partnership with its first members and prints their ids. */
async function createPartnershipCommand(
  db: Database,
  { print }: AdminOutput,
  rest: string[],
): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      name: { type: "string" },
      admin: { type: "string", multiple: true, default: [] },
      partner: { type: "string", multiple: true, default: [] },
      reader: { type: "string", multiple: true, default: [] },
      "ballot-rule": { type: "string", default: "majority" },
    },
  });
  if (values.name === undefined) throw new Error(adminUsage);
  const people: NewMember[] = [
    ...values.admin.map((name) => ({ name, role: "admin" as const })),
    ...values.partner.map((name) => ({ name, role: "partner" as const })),
    ...values.reader.map((name) => ({ name, role: "reader" as const })),
  ];
  const created = await createPartnership(db, {
    name: values.name,
    members: people,
    entryBallotRule: ballotRule(values["ballot-rule"]),
    actorId: null,
  });
  print(`partnership ${created.id}`);
  for (const m of created.members) {
    print(`  ${m.id}  ${m.role.padEnd(7)}  ${m.name}`);
  }
  print("next: admin-cli invite <member id>, for each member");
}

/** How the partnership's ballots on entries are decided (ADR 0004). */
async function setBallotRuleCommand(
  db: Database,
  { print }: AdminOutput,
  rest: string[],
): Promise<void> {
  const [partnershipId, rule] = rest;
  if (partnershipId === undefined) throw new Error(adminUsage);
  const { before, after } = await setEntryBallotRule(db, {
    partnershipId,
    rule: ballotRule(rule),
    actorId: null,
  });
  print(
    before === after
      ? `entry ballots: already ${after}`
      : `entry ballots: ${before} -> ${after}`,
  );
}

/** Every member of every partnership, with the ids invite needs. */
async function listMembersCommand(
  db: Database,
  { print }: AdminOutput,
): Promise<void> {
  for (const m of await listMembers(db)) {
    print(
      `${m.id}  ${m.role.padEnd(7)}  ${m.name}  (${m.partnershipName}, ${m.partnershipId})`,
    );
  }
}

/** Creates a project with each partner's weight, and prints the draw order. */
async function createProjectCommand(
  db: Database,
  { print }: AdminOutput,
  rest: string[],
): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      partnership: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", default: "construction" },
      "starts-on": { type: "string" },
      weight: { type: "string", multiple: true, default: [] },
    },
  });
  const { partnership, name, kind } = values;
  const startsOn = values["starts-on"];
  if (
    partnership === undefined ||
    name === undefined ||
    startsOn === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) ||
    (kind !== "construction" && kind !== "ongoing")
  ) {
    throw new Error(adminUsage);
  }
  const weights: NewWeight[] = values.weight.map((pair) => {
    const [memberId, weight] = pair.split("=");
    if (memberId === undefined || weight === undefined) {
      throw new Error(`a weight is <member id>=<n>, not "${pair}"`);
    }
    return { memberId, weight: Number(weight) };
  });
  const created = await createProject(db, {
    partnershipId: partnership,
    name,
    kind,
    startsOn,
    weights,
    actorId: null,
  });
  print(`project ${created.id}`);
  for (const w of [...created.weights].sort(
    (a, b) => a.drawPosition - b.drawPosition,
  )) {
    print(`  draw ${w.drawPosition}  weight ${w.weight}  ${w.memberId}`);
  }
}

/** Every project, with its partnership. */
async function listProjectsCommand(
  db: Database,
  { print }: AdminOutput,
): Promise<void> {
  for (const p of await listProjects(db)) {
    print(
      `${p.id}  ${p.kind.padEnd(12)}  ${p.startsOn}  ${p.name}  (${p.partnershipName})`,
    );
  }
}

/** Adds categories to a partnership; those it already has are skipped. */
async function addCategoriesCommand(
  db: Database,
  { print }: AdminOutput,
  rest: string[],
): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      partnership: { type: "string" },
      name: { type: "string", multiple: true, default: [] },
    },
  });
  if (values.partnership === undefined || values.name.length === 0) {
    throw new Error(adminUsage);
  }
  const added = await addCategories(db, {
    partnershipId: values.partnership,
    names: values.name,
    actorId: null,
  });
  print(added.length === 0 ? "nothing new" : `added: ${added.join(", ")}`);
}

function inviteBaseUrl(publicUrl: string | undefined): string {
  if (publicUrl === undefined || publicUrl === "") {
    throw new Error("PUBLIC_URL is not set");
  }
  return publicUrl.replace(/\/+$/, "");
}

function printInvite(
  print: AdminOutput["print"],
  baseUrl: string,
  { token, expiresAt }: { token: string; expiresAt: Date },
): void {
  // The token can't be shown again: only its hash is stored.
  print(`${baseUrl}/convite/${token}`);
  print(`valid until ${expiresAt.toISOString()}, for one tap`);
}

/** A new one-tap invite link for a member; the token is shown once. */
async function inviteCommand(
  db: Database,
  { publicUrl, print }: AdminOutput,
  rest: string[],
): Promise<void> {
  const [memberId] = rest;
  if (memberId === undefined) throw new Error(adminUsage);
  const baseUrl = inviteBaseUrl(publicUrl);
  const invite = await createInvite(db, {
    memberId,
    createdBy: null,
  });
  printInvite(print, baseUrl, invite);
}

async function emergencyInviteCommand(
  db: Database,
  { publicUrl, print, startQueue }: AdminOutput,
  rest: string[],
): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: { partnership: { type: "string" }, name: { type: "string" } },
  });
  const partnershipId = values.partnership;
  const name = values.name?.trim();
  if (!partnershipId || !name) throw new Error(adminUsage);
  const baseUrl = inviteBaseUrl(publicUrl);
  const boss = await startQueue();
  try {
    const invite = await createEmergencyInvite(db, boss, {
      partnershipId,
      name,
    });
    print(`member ${invite.memberId}`);
    printInvite(print, baseUrl, invite);
  } finally {
    await boss.stop({ graceful: false });
  }
}

/**
 * The commands by name. A Map, not an object literal: an object would
 * also answer to inherited names, so "toString" or "constructor" would
 * run as a command instead of printing the usage.
 */
const commands = new Map<string, AdminCommand>([
  ["create-partnership", createPartnershipCommand],
  ["set-ballot-rule", setBallotRuleCommand],
  ["list-members", listMembersCommand],
  ["create-project", createProjectCommand],
  ["list-projects", listProjectsCommand],
  ["add-categories", addCategoriesCommand],
  ["invite", inviteCommand],
  ["emergency-invite", emergencyInviteCommand],
]);

export async function runAdminCommand(
  db: Database,
  args: string[],
  output: AdminOutput,
): Promise<void> {
  const [name, ...rest] = args;
  const command = name === undefined ? undefined : commands.get(name);
  if (command === undefined) throw new Error(adminUsage);
  await command(db, output, rest);
}
