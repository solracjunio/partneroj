import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  addCategories,
  categories,
  createInvite,
  createPartnership,
  createProject,
  entries,
  installJobQueue,
  type PgBoss,
  startJobQueue,
} from "@partneroj/db";
import {
  type AppConnection,
  connectAsApp,
  startTestDatabase,
  type TestDatabase,
} from "@partneroj/db/testing";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.module.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { RECEIPT_STORAGE } from "../receipts/storage.js";

// The HTTP server type supertest accepts (its "supertest/types" subpath is not exported).
type App = Parameters<typeof request>[0];

let t: TestDatabase;
let conn: AppConnection;
let boss: PgBoss;
let app: INestApplication<App>;

beforeAll(async () => {
  t = await startTestDatabase();
  // As in production: the owner installs pg-boss, the API only sends.
  await installJobQueue(t.connectionString);
  conn = await connectAsApp(t);
  boss = await startJobQueue(conn.connectionString, { sendOnly: true });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(conn.db)
    .overrideProvider(JOB_QUEUE)
    .useValue(boss)
    .overrideProvider(RECEIPT_STORAGE)
    .useValue({})
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close(); // Ends conn.db's pool and stops boss (the modules).
  await t?.stop();
});

const http = () => request(app.getHttpServer());

function cookieOf(setCookie: unknown): string {
  const [first] = setCookie as string[];
  return first!.split(";")[0]!;
}

/** A session cookie for a member, through the real invite flow. */
async function signIn(memberId: string): Promise<string> {
  const { token } = await createInvite(conn.db, { memberId, createdBy: null });
  const response = await http()
    .post(`/auth/invites/${token}/accept`)
    .expect(204);
  return cookieOf(response.headers["set-cookie"]);
}

/** João (admin, weight 1), Maria (admin, weight 1), Leo (reader). */
async function seed(name = "Obra Teste", withProject = true) {
  const p = await createPartnership(conn.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, maria, leo] = p.members.map((m) => m.id);
  if (!withProject) {
    return { joao: joao!, leo: leo!, projectId: "", materialId: "" };
  }
  const project = await createProject(conn.db, {
    partnershipId: p.id,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: [
      { memberId: joao!, weight: 1 },
      { memberId: maria!, weight: 1 },
    ],
    actorId: null,
  });
  await addCategories(conn.db, {
    partnershipId: p.id,
    names: ["Material", "Taxas"],
    actorId: null,
  });
  const [material] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id))
    .orderBy(categories.name);
  return {
    joao: joao!,
    leo: leo!,
    projectId: project.id,
    materialId: material!.id,
  };
}

const body = (s: { projectId: string; materialId: string }) => ({
  projectId: s.projectId,
  amountCents: "15000",
  categoryId: s.materialId,
  occurredOn: "2027-01-12",
  description: "cimento",
});

describe("GET /projects/current", () => {
  it("returns the project and the category buttons", async () => {
    const s = await seed();
    const cookie = await signIn(s.joao);
    const response = await http()
      .get("/projects/current")
      .set("Cookie", cookie)
      .expect(200);
    expect(response.body).toMatchObject({
      project: { id: s.projectId, name: "Casa" },
      categories: [{ name: "Material" }, { name: "Taxas" }],
    });
  });

  it("answers 404 when the partnership has no project yet", async () => {
    const s = await seed("Sem Projeto", false);
    const cookie = await signIn(s.joao);
    await http().get("/projects/current").set("Cookie", cookie).expect(404);
  });

  it("answers 401 without a session", async () => {
    await http().get("/projects/current").expect(401);
  });
});

describe("POST /entries/expenses", () => {
  it("records the expense as paid from the signed-in member's pocket", async () => {
    const s = await seed();
    const cookie = await signIn(s.joao);
    const response = await http()
      .post("/entries/expenses")
      .set("Cookie", cookie)
      .send(body(s))
      .expect(201);
    expect(response.body).toMatchObject({
      amountCents: "15000",
      occurredOn: "2027-01-12",
    });
    const [row] = await t.db
      .select()
      .from(entries)
      .where(eq(entries.id, (response.body as { id: string }).id));
    expect(row).toMatchObject({
      fromMemberId: s.joao,
      authorId: s.joao,
      amount: 15000n,
    });
  });

  it("ignores a 'who paid' field: the payer is the session", async () => {
    const s = await seed();
    const cookie = await signIn(s.joao);
    const response = await http()
      .post("/entries/expenses")
      .set("Cookie", cookie)
      .send({ ...body(s), fromMemberId: s.leo })
      .expect(201);
    const [row] = await t.db
      .select()
      .from(entries)
      .where(eq(entries.id, (response.body as { id: string }).id));
    expect(row!.fromMemberId).toBe(s.joao);
  });

  it("answers 400 with the wrong fields, for an amount as a number", async () => {
    const s = await seed();
    const cookie = await signIn(s.joao);
    const response = await http()
      .post("/entries/expenses")
      .set("Cookie", cookie)
      .send({ ...body(s), amountCents: 150.5, occurredOn: "12/01/2027" })
      .expect(400);
    expect(response.body).toMatchObject({
      message: "invalid_body",
      fields: ["amountCents", "occurredOn"],
    });
  });

  it("answers 422 for a category of another partnership", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    const cookie = await signIn(ours.joao);
    await http()
      .post("/entries/expenses")
      .set("Cookie", cookie)
      .send({ ...body(ours), categoryId: theirs.materialId })
      .expect(422);
  });

  it("refuses a reader", async () => {
    const s = await seed();
    const cookie = await signIn(s.leo);
    await http()
      .post("/entries/expenses")
      .set("Cookie", cookie)
      .send(body(s))
      .expect(403);
  });

  it("answers 401 without a session", async () => {
    const s = await seed();
    await http().post("/entries/expenses").send(body(s)).expect(401);
  });
});

describe("POST /entries/:entryId/reverse", () => {
  /** João records the expense; returns its id and his cookie. */
  async function recorded() {
    const s = await seed();
    const joao = await signIn(s.joao);
    const response = await http()
      .post("/entries/expenses")
      .set("Cookie", joao)
      .send(body(s))
      .expect(201);
    return { s, joao, entryId: (response.body as { id: string }).id };
  }

  it("undoes the author's own entry with a reversal", async () => {
    const { joao, entryId } = await recorded();
    const response = await http()
      .post(`/entries/${entryId}/reverse`)
      .set("Cookie", joao)
      .send({ reason: " lancei duas vezes " })
      .expect(201);
    expect(response.body).toMatchObject({
      reversalOf: entryId,
      amountCents: "-15000",
    });
    const [row] = await t.db
      .select()
      .from(entries)
      .where(eq(entries.reversalOf, entryId));
    expect(row!.reversalReason).toBe("lancei duas vezes");
  });

  it("answers 409 the second time", async () => {
    const { joao, entryId } = await recorded();
    const undo = () =>
      http()
        .post(`/entries/${entryId}/reverse`)
        .set("Cookie", joao)
        .send({ reason: "errado" });
    await undo().expect(201);
    await undo().expect(409);
  });

  it("answers 403 to someone who is not the author", async () => {
    const { s, entryId } = await recorded();
    const leo = await signIn(s.leo);
    await http()
      .post(`/entries/${entryId}/reverse`)
      .set("Cookie", leo)
      .send({ reason: "errado" })
      .expect(403);
  });

  it("answers 404 for another partnership's entry and for a non-id", async () => {
    const { entryId } = await recorded();
    const other = await seed("Outra Obra");
    const outsider = await signIn(other.joao);
    for (const id of [entryId, "abc"]) {
      await http()
        .post(`/entries/${id}/reverse`)
        .set("Cookie", outsider)
        .send({ reason: "errado" })
        .expect(404);
    }
  });

  it("answers 400 without a reason", async () => {
    const { joao, entryId } = await recorded();
    for (const reason of [undefined, "   "]) {
      await http()
        .post(`/entries/${entryId}/reverse`)
        .set("Cookie", joao)
        .send({ reason })
        .expect(400);
    }
  });

  it("answers 401 without a session", async () => {
    const { entryId } = await recorded();
    await http()
      .post(`/entries/${entryId}/reverse`)
      .send({ reason: "errado" })
      .expect(401);
  });
});
