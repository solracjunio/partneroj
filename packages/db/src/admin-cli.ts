// Commands run on the server (docs/operacao.md), for what can't be done
// from the app: the first partnership and its first invites, before
// anybody has a session, and the emergency procedure, when both admins
// lost access (plan section 2). Each change is audited with a null actor,
// which is how the audit tells a server command from a member.
//
// It connects as the app login (DATABASE_URL), not as the owner, so it
// goes through the same privileges as the API.
import { parseArgs } from "node:util";
import { createDatabase, type Database } from "./client.js";
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

const usage = `Usage:
  admin-cli create-partnership --name <name> --admin <name> --admin <name>
                               [--partner <name>]... [--reader <name>]...
  admin-cli list-members
  admin-cli invite <member id>
  admin-cli create-project --partnership <id> --name <name> --starts-on <YYYY-MM-DD>
                           [--kind construction|ongoing] --weight <member id>=<n>...
  admin-cli list-projects
  admin-cli add-categories --partnership <id> --name <name>...`;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function run(db: Database, args: string[]): Promise<void> {
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
      if (values.name === undefined) throw new Error(usage);
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
      console.log(`partnership ${created.id}`);
      for (const m of created.members) {
        console.log(`  ${m.id}  ${m.role.padEnd(7)}  ${m.name}`);
      }
      console.log("next: admin-cli invite <member id>, for each member");
      return;
    }

    case "list-members": {
      for (const m of await listMembers(db)) {
        console.log(
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
        throw new Error(usage);
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
      console.log(`project ${created.id}`);
      for (const w of [...created.weights].sort(
        (a, b) => a.drawPosition - b.drawPosition,
      )) {
        console.log(
          `  draw ${w.drawPosition}  weight ${w.weight}  ${w.memberId}`,
        );
      }
      return;
    }

    case "list-projects": {
      for (const p of await listProjects(db)) {
        console.log(
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
        throw new Error(usage);
      }
      const added = await addCategories(db, {
        partnershipId: values.partnership,
        names: values.name,
        actorId: null,
      });
      console.log(
        added.length === 0 ? "nothing new" : `added: ${added.join(", ")}`,
      );
      return;
    }

    case "invite": {
      const [memberId] = rest;
      if (memberId === undefined) throw new Error(usage);
      const baseUrl = required("PUBLIC_URL").replace(/\/+$/, "");
      const { token, expiresAt } = await createInvite(db, {
        memberId,
        createdBy: null,
      });
      // The token can't be shown again: only its hash is stored.
      console.log(`${baseUrl}/convite/${token}`);
      console.log(`valid until ${expiresAt.toISOString()}, for one tap`);
      return;
    }

    default:
      throw new Error(usage);
  }
}

const db = createDatabase(required("DATABASE_URL"));
try {
  await run(db, process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
