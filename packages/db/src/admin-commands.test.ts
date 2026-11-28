import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminUsage, runAdminCommand } from "./admin-commands.js";
import { countUnread, listFeed, markFeedRead } from "./feed.js";
import { previewInvite } from "./invites.js";
import { installJobQueue, queues, startJobQueue } from "./jobs.js";
import {
  auditLog,
  categories,
  invites,
  members,
  partnerships,
  weights,
} from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

let t: TestDatabase;
let app: AppConnection;
beforeAll(async () => {
  t = await startTestDatabase();
  await installJobQueue(t.connectionString);
  // As on the server: the commands connect as the app login, not the owner.
  app = await connectAsApp(t);
});
afterAll(async () => {
  await app?.db.$client.end();
  await t?.stop();
});

/**
 * Runs a command and returns the lines it printed. The address comes in an
 * object: an `undefined` argument would fall back to a default value.
 */
async function admin(
  args: string[],
  { publicUrl }: { publicUrl: string | undefined } = {
    publicUrl: "https://partneroj.example/",
  },
): Promise<string[]> {
  const lines: string[] = [];
  await runAdminCommand(app.db, args, {
    publicUrl,
    print: (line) => lines.push(line),
    startQueue: () => startJobQueue(app.connectionString, { sendOnly: true }),
  });
  return lines;
}

/** The message a command failed with. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  return "no error";
}

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** A partnership made by the command; returns its id and members' ids. */
async function partnership(name: string) {
  const lines = await admin([
    "create-partnership",
    "--name",
    name,
    "--admin",
    "Ana",
    "--admin",
    "Bruno",
    "--partner",
    "Caio",
    "--reader",
    "Davi",
  ]);
  const id = uuid.exec(lines[0]!)![0];
  const member = (who: string) =>
    uuid.exec(lines.find((line) => line.endsWith(who))!)![0];
  return {
    lines,
    id,
    ana: member("Ana"),
    bruno: member("Bruno"),
    caio: member("Caio"),
    davi: member("Davi"),
  };
}

async function ruleOf(partnershipId: string) {
  const [row] = await t.db
    .select({ rule: partnerships.entryBallotRule })
    .from(partnerships)
    .where(eq(partnerships.id, partnershipId));
  return row!.rule;
}

describe("create-partnership", () => {
  it("creates it with every member and role, audited with no actor", async () => {
    const p = await partnership("Obra Um");
    expect(p.lines[0]).toBe(`partnership ${p.id}`);
    expect(p.lines.slice(1, 5)).toEqual([
      `  ${p.ana}  admin    Ana`,
      `  ${p.bruno}  admin    Bruno`,
      `  ${p.caio}  partner  Caio`,
      `  ${p.davi}  reader   Davi`,
    ]);
    expect(p.lines.at(-1)).toMatch(/^next: admin-cli invite/);
    const audited = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, p.id), isNull(auditLog.actorId)));
    expect(audited.map((row) => row.action)).toEqual(["partnership.create"]);
  });

  it("answers with the usage without a name, creating nothing", async () => {
    expect(await failure(admin(["create-partnership", "--admin", "Ana"]))).toBe(
      adminUsage,
    );
  });

  it("decides ballots by majority, or as --ballot-rule says", async () => {
    const byDefault = await partnership("Obra Maioria");
    expect(await ruleOf(byDefault.id)).toBe("majority");
    const lines = await admin([
      "create-partnership",
      "--name",
      "Obra Unânime",
      "--admin",
      "Ana",
      "--admin",
      "Bruno",
      "--ballot-rule",
      "unanimity",
    ]);
    expect(await ruleOf(uuid.exec(lines[0]!)![0])).toBe("unanimity");
  });

  it("answers with the usage for a rule it doesn't know", async () => {
    const args = ["create-partnership", "--name", "Obra Regra Errada"];
    const admins = ["--admin", "Ana", "--admin", "Bruno"];
    expect(
      await failure(admin([...args, ...admins, "--ballot-rule", "todos"])),
    ).toBe(adminUsage);
  });

  it("passes on the domain's refusal of a single admin", async () => {
    const message = await failure(
      admin(["create-partnership", "--name", "Obra Só", "--admin", "Ana"]),
    );
    expect(message).not.toBe("no error");
    expect(message).not.toBe(adminUsage);
  });
});

describe("emergency-invite", () => {
  it("creates a new admin and an auditable invite that can be replaced", async () => {
    const p = await partnership("Obra Emergência");
    const [line, link] = await admin([
      "emergency-invite",
      "--partnership",
      p.id,
      "--name",
      "Eva",
    ]);
    const id = uuid.exec(line!)![0];
    const token = link!.split("/").at(-1)!;
    expect(await previewInvite(app.db, token)).toEqual({
      memberName: "Eva",
      partnershipName: "Obra Emergência",
    });
    expect(
      await t.db.select().from(members).where(eq(members.id, id)),
    ).toMatchObject([{ partnershipId: p.id, role: "admin", name: "Eva" }]);
    const [invite] = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, id));
    const audited = await t.db
      .select()
      .from(auditLog)
      .where(and(isNull(auditLog.actorId), eq(auditLog.entityId, id)));
    expect(audited).toMatchObject([{ action: "member.emergency_create" }]);
    const inviteAudit = await t.db
      .select()
      .from(auditLog)
      .where(and(isNull(auditLog.actorId), eq(auditLog.entityId, invite!.id)));
    expect(inviteAudit).toMatchObject([{ action: "invite.create" }]);
    expect(JSON.stringify([...audited, ...inviteAudit])).not.toContain(token);
    const reader = { memberId: p.davi, partnershipId: p.id };
    const {
      rows: [activity],
    } = await listFeed(app.db, { ...reader, limit: 5 });
    expect(activity).toMatchObject({
      action: "emergency_admin_created",
      actor: null,
      entry: null,
      targetMember: { id, name: "Eva" },
      unread: true,
    });
    expect(await countUnread(app.db, reader)).toBe(1);
    await markFeedRead(app.db, { ...reader, ids: [activity!.id] });
    expect(await countUnread(app.db, reader)).toBe(0);
    const other = await partnership("Outra Sociedade");
    expect(
      await listFeed(app.db, {
        memberId: other.davi,
        partnershipId: other.id,
        limit: 5,
      }),
    ).toEqual({ rows: [], next: null });
    const jobs = await t.db.$client.query<{ data: unknown }>(
      "SELECT data FROM pgboss.job WHERE name = $1 AND data->>'activityId' = $2",
      [queues.emergencyNotification, activity!.id],
    );
    expect(jobs.rows).toEqual([{ data: { activityId: activity!.id } }]);
    const [replacement] = await admin(["invite", id]);
    expect(await previewInvite(app.db, token)).toBeNull();
    expect(
      await previewInvite(app.db, replacement!.split("/").at(-1)!),
    ).toMatchObject({ memberName: "Eva" });
  });

  it("rolls back and prints no link when the notification cannot be queued", async () => {
    const p = await partnership("Obra Sem Fila");
    const print = vi.fn();
    const boss = await startJobQueue(app.connectionString, { sendOnly: true });
    vi.spyOn(boss, "send").mockRejectedValueOnce(
      new Error("queue unavailable"),
    );
    await expect(
      runAdminCommand(
        app.db,
        ["emergency-invite", "--partnership", p.id, "--name", "Eva"],
        {
          publicUrl: "https://partneroj.example",
          print,
          startQueue: () => Promise.resolve(boss),
        },
      ),
    ).rejects.toThrow("queue unavailable");
    expect(print).not.toHaveBeenCalled();
    const result = await t.db
      .select()
      .from(members)
      .where(eq(members.partnershipId, p.id));
    expect(result.map((m) => m.id).sort()).toEqual(
      [p.ana, p.bruno, p.caio, p.davi].sort(),
    );
    expect(
      await countUnread(app.db, { partnershipId: p.id, memberId: p.davi }),
    ).toBe(0);
  });
});

describe("set-ballot-rule", () => {
  it("changes the rule, says from what to what, and only once", async () => {
    const p = await partnership("Obra Troca");
    expect(await admin(["set-ballot-rule", p.id, "unanimity"])).toEqual([
      "entry ballots: majority -> unanimity",
    ]);
    expect(await ruleOf(p.id)).toBe("unanimity");
    expect(await admin(["set-ballot-rule", p.id, "unanimity"])).toEqual([
      "entry ballots: already unanimity",
    ]);
    const audited = await t.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, p.id),
          eq(auditLog.action, "partnership.set_entry_ballot_rule"),
          isNull(auditLog.actorId),
        ),
      );
    expect(audited).toHaveLength(1);
  });

  it("answers with the usage without an id or with an unknown rule", async () => {
    const p = await partnership("Obra Uso");
    for (const args of [
      ["set-ballot-rule"],
      ["set-ballot-rule", p.id],
      ["set-ballot-rule", p.id, "todos"],
    ])
      expect(await failure(admin(args))).toBe(adminUsage);
    expect(await ruleOf(p.id)).toBe("majority");
  });
});

describe("list-members", () => {
  it("lists each member with role and partnership", async () => {
    const p = await partnership("Obra Lista");
    const lines = await admin(["list-members"]);
    expect(lines).toContain(`${p.caio}  partner  Caio  (Obra Lista, ${p.id})`);
  });
});

describe("invite", () => {
  it("prints a link that opens the member's invite, without a doubled slash", async () => {
    const p = await partnership("Obra Convite");
    const [link, validity] = await admin(["invite", p.caio]);
    const prefix = "https://partneroj.example/convite/";
    expect(link!.startsWith(prefix)).toBe(true);
    const token = link!.slice(prefix.length);
    expect(await previewInvite(app.db, token)).toEqual({
      memberName: "Caio",
      partnershipName: "Obra Convite",
    });
    expect(validity).toMatch(/^valid until \d{4}-\d{2}-\d{2}T.*, for one tap$/);
  });

  it("records the invite as made by the server, with no author", async () => {
    const p = await partnership("Obra Autor");
    await admin(["invite", p.ana]);
    const [row] = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, p.ana));
    expect(row!.createdBy).toBeNull();
  });

  it("refuses without PUBLIC_URL before creating an invite", async () => {
    const p = await partnership("Obra Sem Url");
    expect(
      await failure(admin(["invite", p.bruno], { publicUrl: undefined })),
    ).toBe("PUBLIC_URL is not set");
    expect(await failure(admin(["invite", p.bruno], { publicUrl: "" }))).toBe(
      "PUBLIC_URL is not set",
    );
    const rows = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, p.bruno));
    expect(rows).toEqual([]);
  });

  it("answers with the usage without a member id", async () => {
    expect(await failure(admin(["invite"]))).toBe(adminUsage);
  });
});

describe("create-project", () => {
  const project = (p: { id: string }, ...extra: string[]) => [
    "create-project",
    "--partnership",
    p.id,
    "--name",
    "Casa",
    "--starts-on",
    "2027-01-11",
    ...extra,
  ];

  it("creates it with the weights and prints them in draw order", async () => {
    const p = await partnership("Obra Projeto");
    const lines = await admin(
      project(p, "--weight", `${p.ana}=2`, "--weight", `${p.caio}=1`),
    );
    const id = uuid.exec(lines[0]!)![0];
    expect(lines[0]).toBe(`project ${id}`);
    const draws = lines.slice(1).map((line) => /draw (\d+)/.exec(line)![1]);
    expect(draws).toEqual([...draws].sort());
    const rows = await t.db
      .select({ memberId: weights.memberId, weight: weights.weight })
      .from(weights)
      .where(eq(weights.projectId, id));
    expect(rows).toEqual(
      expect.arrayContaining([
        { memberId: p.ana, weight: 2 },
        { memberId: p.caio, weight: 1 },
      ]),
    );
  });

  it("refuses a weight that is not a whole number", async () => {
    const p = await partnership("Obra Peso");
    for (const weight of ["abc", "1.5", "0", ""]) {
      expect(
        await failure(admin(project(p, "--weight", `${p.ana}=${weight}`))),
      ).toBe("a weight must be a whole number of at least 1");
    }
  });

  it("refuses a weight without '='", async () => {
    const p = await partnership("Obra Par");
    expect(await failure(admin(project(p, "--weight", p.ana)))).toBe(
      `a weight is <member id>=<n>, not "${p.ana}"`,
    );
  });

  it("answers with the usage for a bad date or kind", async () => {
    const p = await partnership("Obra Data");
    const weight = ["--weight", `${p.ana}=1`];
    expect(
      await failure(
        admin([
          "create-project",
          "--partnership",
          p.id,
          "--name",
          "Casa",
          "--starts-on",
          "11/01/2027",
          ...weight,
        ]),
      ),
    ).toBe(adminUsage);
    expect(await failure(admin(project(p, "--kind", "house", ...weight)))).toBe(
      adminUsage,
    );
  });

  it("refuses a reader's weight", async () => {
    const p = await partnership("Obra Leitor");
    expect(await failure(admin(project(p, "--weight", `${p.davi}=1`)))).toBe(
      "every weight must be of a partner or admin of this partnership",
    );
  });
});

describe("list-projects", () => {
  it("lists the project with kind, start and partnership", async () => {
    const p = await partnership("Obra Projetos");
    const [created] = await admin([
      "create-project",
      "--partnership",
      p.id,
      "--name",
      "Loja",
      "--kind",
      "ongoing",
      "--starts-on",
      "2027-02-01",
      "--weight",
      `${p.ana}=1`,
    ]);
    const id = uuid.exec(created!)![0];
    expect(await admin(["list-projects"])).toContain(
      `${id}  ongoing       2027-02-01  Loja  (Obra Projetos)`,
    );
  });
});

describe("add-categories", () => {
  it("adds the new names and says when there is nothing new", async () => {
    const p = await partnership("Obra Categorias");
    const args = [
      "add-categories",
      "--partnership",
      p.id,
      "--name",
      "Material",
      "--name",
      "Taxas",
    ];
    expect(await admin(args)).toEqual(["added: Material, Taxas"]);
    expect(await admin(args)).toEqual(["nothing new"]);
    const rows = await t.db
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.partnershipId, p.id));
    expect(rows.map((r) => r.name).sort()).toEqual(["Material", "Taxas"]);
  });

  it("answers with the usage without a name", async () => {
    const p = await partnership("Obra Sem Nome");
    expect(
      await failure(admin(["add-categories", "--partnership", p.id])),
    ).toBe(adminUsage);
  });
});

it.each(["toString", "constructor", "__proto__"])(
  "answers a name every object inherits, %s, with the usage",
  async (name) => {
    // Not run as a command: only the names listed are commands.
    expect(await failure(admin([name]))).toBe(adminUsage);
  },
);

it("answers an unknown or missing command with the usage", async () => {
  expect(await failure(admin(["delete-everything"]))).toBe(adminUsage);
  expect(await failure(admin([]))).toBe(adminUsage);
});
