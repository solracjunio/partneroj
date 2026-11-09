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

const usage = `Usage:
  admin-cli create-partnership --name <name> --admin <name> --admin <name>
                               [--partner <name>]... [--reader <name>]...
  admin-cli list-members
  admin-cli invite <member id>`;

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
          `${m.id}  ${m.role.padEnd(7)}  ${m.name}  (${m.partnershipName})`,
        );
      }
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
