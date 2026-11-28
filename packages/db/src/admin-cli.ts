// Commands run on the server (docs/operacao.md), for what can't be done
// from the app: the first partnership and its first invites, before
// anybody has a session, and the emergency procedure, when all admins
// lost access (plan section 2). Each change is audited with a null actor,
// which is how the audit tells a server command from a member.
//
// It connects as the app login (DATABASE_URL), not as the owner, so it
// goes through the same privileges as the API.
import { runAdminCommand } from "./admin-commands.js";
import { createDatabase } from "./client.js";
import { startJobQueue } from "./jobs.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const db = createDatabase(databaseUrl);
try {
  await runAdminCommand(db, process.argv.slice(2), {
    publicUrl: process.env.PUBLIC_URL,
    print: (line) => console.log(line),
    startQueue: () => startJobQueue(databaseUrl, { sendOnly: true }),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
