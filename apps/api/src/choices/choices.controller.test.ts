import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Choice } from "@partneroj/contracts";
import {
  auditLog,
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
  await installJobQueue(t.connectionString);
  conn = await connectAsApp(t);
  boss = await startJobQueue(conn.connectionString, { sendOnly: true });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // Signs in many times a second; the limit has its own test (throttle.test.ts).
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
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

/** João and Maria (admins), Ana (partner) and Leo (reader), signed in. */
async function seed(name = "Obra Teste") {
  const p = await createPartnership(conn.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Ana", role: "partner" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, maria, ana, leo] = p.members.map((m) => m.id) as [
    string,
    string,
    string,
    string,
  ];
  return {
    partnershipId: p.id,
    ids: { joao, maria, ana, leo },
    joao: await signIn(joao),
    ana: await signIn(ana),
    leo: await signIn(leo),
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

describe.each(["accounts", "categories"] as const)("/%s", (list) => {
  const create = (cookie: string, name: unknown) =>
    http().post(`/${list}`).set("Cookie", cookie).send({ name });
  const change = (cookie: string, id: string, body: object) =>
    http().patch(`/${list}/${id}`).set("Cookie", cookie).send(body);
  const listed = async (cookie: string, query = "") =>
    (
      await http()
        .get(`/${list}${query}`)
        .set("Cookie", cookie)
        .expect(200)
        .expect("Cache-Control", "no-store")
    ).body as Choice[];

  async function created(s: Seed, name: string): Promise<Choice> {
    return (await create(s.joao, name).expect(201)).body as Choice;
  }

  describe("POST", () => {
    it("creates one for an admin, with the name trimmed, audited as them", async () => {
      const s = await seed();
      const choice = await created(s, "  Caixa ");
      expect(choice).toEqual({
        id: choice.id,
        name: "Caixa",
        archivedAt: null,
      });
      const [audit] = await t.db
        .select({ actorId: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.entityId, choice.id));
      expect(audit!.actorId).toBe(s.ids.joao);
    });

    it("answers 403 to a partner and to a reader", async () => {
      const s = await seed();
      await create(s.ana, "Caixa").expect(403);
      await create(s.leo, "Caixa").expect(403);
      expect(await listed(s.joao)).toEqual([]);
    });

    it("answers 409 for a name the partnership already has", async () => {
      const s = await seed();
      await created(s, "Caixa");
      const response = await create(s.joao, " Caixa").expect(409);
      expect((response.body as { message: string }).message).toBe("name-taken");
    });

    it.each([
      ["no name", undefined],
      ["a blank name", "  "],
      ["61 characters", "x".repeat(61)],
    ])("answers 400 for %s", async (_, name) => {
      const s = await seed();
      await create(s.joao, name).expect(400);
    });

    it("answers 401 without a session", async () => {
      await http().post(`/${list}`).send({ name: "Caixa" }).expect(401);
    });
  });

  describe("GET", () => {
    it("lists the partnership's own by name, for every member, readers included", async () => {
      const s = await seed();
      const other = await seed("Outra Obra");
      await created(other, "Alheia");
      const b = await created(s, "Banco");
      const a = await created(s, "Areia");
      expect(await listed(s.leo)).toEqual([a, b]);
    });

    it("leaves the archived ones out unless asked", async () => {
      const s = await seed();
      const a = await created(s, "Areia");
      const archived = (
        await change(s.joao, a.id, { archived: true }).expect(200)
      ).body as Choice;
      expect(await listed(s.ana)).toEqual([]);
      expect(await listed(s.ana, "?archived=include")).toEqual([archived]);
    });

    it("answers 400 for an unknown query and 401 without a session", async () => {
      const s = await seed();
      await http()
        .get(`/${list}?archived=yes`)
        .set("Cookie", s.joao)
        .expect(400);
      await http().get(`/${list}`).expect(401);
    });
  });

  describe("PATCH", () => {
    it("renames one, trimmed", async () => {
      const s = await seed();
      const { id } = await created(s, "Caixa");
      const response = await change(s.joao, id, { name: " Cofre " }).expect(
        200,
      );
      expect(response.body).toEqual({ id, name: "Cofre", archivedAt: null });
    });

    it("archives and restores one", async () => {
      const s = await seed();
      const { id } = await created(s, "Caixa");
      const archived = (
        await change(s.joao, id, { archived: true }).expect(200)
      ).body as Choice;
      expect(Number.isNaN(Date.parse(archived.archivedAt!))).toBe(false);
      const restored = (
        await change(s.joao, id, { archived: false }).expect(200)
      ).body as Choice;
      expect(restored).toEqual({ id, name: "Caixa", archivedAt: null });
    });

    it("answers 403 to a partner and to a reader, changing nothing", async () => {
      const s = await seed();
      const choice = await created(s, "Caixa");
      for (const cookie of [s.ana, s.leo]) {
        await change(cookie, choice.id, { name: "Cofre" }).expect(403);
        await change(cookie, choice.id, { archived: true }).expect(403);
      }
      expect(await listed(s.joao)).toEqual([choice]);
    });

    it("answers 404 for another partnership's and for a non-id", async () => {
      const s = await seed();
      const other = await seed("Outra Obra");
      const theirs = await created(other, "Caixa");
      await change(s.joao, theirs.id, { name: "Minha" }).expect(404);
      await change(s.joao, theirs.id, { archived: true }).expect(404);
      await change(s.joao, "abc", { archived: true }).expect(404);
      expect(await listed(other.joao)).toEqual([theirs]);
    });

    it("answers 409 for a name the partnership already has", async () => {
      const s = await seed();
      await created(s, "Caixa");
      const { id } = await created(s, "Cofre");
      const response = await change(s.joao, id, { name: "Caixa" }).expect(409);
      expect((response.body as { message: string }).message).toBe("name-taken");
    });

    it.each([
      ["both changes at once", { name: "Cofre", archived: true }],
      ["no change", {}],
      ["a blank name", { name: " " }],
    ])("answers 400 for %s", async (_, body) => {
      const s = await seed();
      const { id } = await created(s, "Caixa");
      await change(s.joao, id, body).expect(400);
    });

    it("answers 401 without a session", async () => {
      const s = await seed();
      const { id } = await created(s, "Caixa");
      await http().patch(`/${list}/${id}`).send({ archived: true }).expect(401);
    });
  });
});

describe("PATCH /accounts/:id", () => {
  it("answers 409 for an account that holds money", async () => {
    const s = await seed();
    const project = await createProject(conn.db, {
      partnershipId: s.partnershipId,
      name: "Casa",
      kind: "construction",
      startsOn: "2027-01-11",
      weights: [{ memberId: s.ids.joao, weight: 1 }],
      actorId: null,
    });
    const box = (
      await http()
        .post("/accounts")
        .set("Cookie", s.joao)
        .send({ name: "Caixa" })
        .expect(201)
    ).body as Choice;
    await t.db.insert(entries).values({
      projectId: project.id,
      type: "contribution",
      amount: 10000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: s.ids.joao,
      toAccountId: box.id,
      authorId: s.ids.joao,
      source: "app",
    });
    const response = await http()
      .patch(`/accounts/${box.id}`)
      .set("Cookie", s.joao)
      .send({ archived: true })
      .expect(409);
    expect((response.body as { message: string }).message).toBe(
      "account-not-empty",
    );
  });
});
