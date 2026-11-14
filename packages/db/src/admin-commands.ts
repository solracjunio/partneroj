// The admin-cli commands (docs/operacao.md), apart from the process that
// runs them, so the tests call them on a real database: the first
// partnership and its first invites, and the emergency procedure. Each
// change is audited with a null actor, which is how the audit tells a
// server command from a member.
import { parseArgs } from "node:util";
import type { Database } from "./client.js";
import { createInvite } from "./invites.js";
import {
  createPartnership,
  listMembers,
  type NewMember,
} from "./partnerships.js";
import {
  addCategories,
  createProject,
  listProjects,
  type NewWeight,
} from "./projects.js";

export interface AdminOutput {
  /** The site's address, for invite links; only `invite` needs it. */
  publicUrl: string | undefined;
  /** Where each line of the answer goes: the console, or a test's array. */
  print: (line: string) => void;
}

export const adminUsage = `Usage:
  admin-cli create-partnership --name <name> --admin <name> --admin <name>
                               [--partner <name>]... [--reader <name>]...
  admin-cli list-members
  admin-cli invite <member id>
  admin-cli create-project --partnership <id> --name <name> --starts-on <YYYY-MM-DD>
                           [--kind construction|ongoing] --weight <member id>=<n>...
  admin-cli list-projects
  admin-cli add-categories --partnership <id> --name <name>...`;

export async function runAdminCommand(
  db: Database,
  args: string[],
  { publicUrl, print }: AdminOutput,
): Promise<void> {
  const [command, ...rest] = args;
  switch (command) {
    case "create-partnership": {
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: "string" },
          admin: { type: "string", multiple: true, default: [] },
          partner: { type: "string", multiple: true, default: [] },
          reader: { type: "string", multiple: true, default: [] },
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
        actorId: null,
      });
      print(`partnership ${created.id}`);
      for (const m of created.members) {
        print(`  ${m.id}  ${m.role.padEnd(7)}  ${m.name}`);
      }
      print("next: admin-cli invite <member id>, for each member");
      return;
    }

    case "list-members": {
      for (const m of await listMembers(db)) {
        print(
          `${m.id}  ${m.role.padEnd(7)}  ${m.name}  (${m.partnershipName}, ${m.partnershipId})`,
        );
      }
      return;
    }

    case "create-project": {
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
      return;
    }

    case "list-projects": {
      for (const p of await listProjects(db)) {
        print(
          `${p.id}  ${p.kind.padEnd(12)}  ${p.startsOn}  ${p.name}  (${p.partnershipName})`,
        );
      }
      return;
    }

    case "add-categories": {
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
      return;
    }

    case "invite": {
      const [memberId] = rest;
      if (memberId === undefined) throw new Error(adminUsage);
      if (publicUrl === undefined || publicUrl === "") {
        throw new Error("PUBLIC_URL is not set");
      }
      const baseUrl = publicUrl.replace(/\/+$/, "");
      const { token, expiresAt } = await createInvite(db, {
        memberId,
        createdBy: null,
      });
      // The token can't be shown again: only its hash is stored.
      print(`${baseUrl}/convite/${token}`);
      print(`valid until ${expiresAt.toISOString()}, for one tap`);
      return;
    }

    default:
      throw new Error(adminUsage);
  }
}
