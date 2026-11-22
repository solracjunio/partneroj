import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  addCategories,
  categories,
  createInvite,
  createPartnership,
  createProject,
  installJobQueue,
  type PgBoss,
  recordExpense,
  reverseEntry,
  startJobQueue,
} from "@partneroj/db";
import {
  type AppConnection,
  connectAsApp,
  startTestDatabase,
  type TestDatabase,
} from "@partneroj/db/testing";
import { eq } from "drizzle-orm";
import type { ProjectBalances } from "@partneroj/contracts";
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

/** João and Maria (admins, weight 1 each) and Leo (reader), spending. */
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
  const [joao, maria, leo] = p.members.map((m) => m.id) as [
    string,
    string,
    string,
  ];
  const s = {
    partnershipId: p.id,
    joao,
    maria,
    leo,
    projectId: "",
    materialId: "",
  };
  if (!withProject) return s;
  const project = await createProject(conn.db, {
    partnershipId: p.id,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: [
      { memberId: joao, weight: 1 },
      { memberId: maria, weight: 1 },
    ],
    actorId: null,
  });
  await addCategories(conn.db, {
    partnershipId: p.id,
    names: ["Material"],
    actorId: null,
  });
  const [material] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id));
  return { ...s, projectId: project.id, materialId: material!.id };
}

type Seed = Awaited<ReturnType<typeof seed>>;

const spend = (s: Seed, memberId: string, amount: bigint) =>
  recordExpense(
    conn.db,
    boss,
    { memberId, partnershipId: s.partnershipId },
    {
      projectId: s.projectId,
      amount,
      categoryId: s.materialId,
      occurredOn: "2027-01-12",
    },
  );

describe("GET /projects/current/balances", () => {
  it("answers each partner's balance and fair share, in cents as text", async () => {
    const s = await seed();
    await spend(s, s.joao, 30001n);
    const cookie = await signIn(s.maria);
    const response = await http()
      .get("/projects/current/balances")
      .set("Cookie", cookie)
      .expect(200)
      .expect("Cache-Control", "no-store");

    const body = response.body as ProjectBalances;
    expect(body).toMatchObject({
      project: { id: s.projectId, name: "Casa" },
      sameWeights: true,
      resultCents: "-30001",
      accounts: [],
    });
    const byName = Object.fromEntries(body.partners.map((p) => [p.name, p]));
    expect(byName["João"]).toEqual({
      memberId: s.joao,
      name: "João",
      weight: 1,
      contributedCents: "30001",
      withdrawnCents: "0",
      resultPartCents: expect.stringMatching(/^-1500[01]$/) as string,
      balanceCents: expect.stringMatching(/^1500[01]$/) as string,
      fairShareCents: expect.stringMatching(/^1500[01]$/) as string,
    });
    // The extra cent goes to one of them, so the balances add up to zero.
    const total = body.partners.reduce(
      (sum, p) => sum + BigInt(p.balanceCents),
      0n,
    );
    expect(total).toBe(0n);
  });

  it("leaves out an undone expense", async () => {
    const s = await seed();
    const wrong = await spend(s, s.maria, 6000n);
    await reverseEntry(
      conn.db,
      boss,
      { memberId: s.maria, partnershipId: s.partnershipId },
      { entryId: wrong.id, reason: "lancei duas vezes" },
    );
    const cookie = await signIn(s.maria);
    const response = await http()
      .get("/projects/current/balances")
      .set("Cookie", cookie)
      .expect(200);
    const body = response.body as ProjectBalances;
    expect(body.resultCents).toBe("0");
    expect(body.partners.every((p) => p.contributedCents === "0")).toBe(true);
  });

  it("is open to a reader, who has no weight and is not listed", async () => {
    const s = await seed();
    const cookie = await signIn(s.leo);
    const response = await http()
      .get("/projects/current/balances")
      .set("Cookie", cookie)
      .expect(200);
    const body = response.body as ProjectBalances;
    expect(body.partners.map((p) => p.memberId)).not.toContain(s.leo);
    expect(body.partners).toHaveLength(2);
  });

  it("shows only the member's own partnership", async () => {
    const ours = await seed("Obra Nossa");
    const theirs = await seed("Obra Deles");
    await spend(theirs, theirs.joao, 50000n);
    const cookie = await signIn(ours.joao);
    const response = await http()
      .get("/projects/current/balances")
      .set("Cookie", cookie)
      .expect(200);
    const body = response.body as ProjectBalances;
    expect(body.project.id).toBe(ours.projectId);
    expect(body.resultCents).toBe("0");
  });

  it("answers 404 when the partnership has no project yet", async () => {
    const s = await seed("Sem Projeto", false);
    const cookie = await signIn(s.joao);
    const response = await http()
      .get("/projects/current/balances")
      .set("Cookie", cookie)
      .expect(404);
    // The route's own 404, not an unknown route's.
    expect(response.body).toMatchObject({ message: "no_project" });
  });

  it("answers 401 without a session", async () => {
    await http().get("/projects/current/balances").expect(401);
  });
});
