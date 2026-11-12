import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  addCategories,
  categories,
  createInvite,
  createPartnership,
  createProject,
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

interface FeedBody {
  items: {
    id: string;
    action: string;
    at: string;
    actor: { name: string };
    unread: boolean;
    entry: { amountCents: string; category: string | null } | null;
  }[];
  next: string | null;
}

describe("GET /activities", () => {
  it("lists the partnership's activities, amounts in cents as strings", async () => {
    const s = await seed();
    const joao = await signIn(s.joao);
    await http()
      .post("/entries/expenses")
      .set("Cookie", joao)
      .send(body(s))
      .expect(201);
    // Leo is a reader: he can't record, but he sees everything.
    const leo = await signIn(s.leo);
    const response = await http()
      .get("/activities")
      .set("Cookie", leo)
      .expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const feed = response.body as FeedBody;
    expect(feed.next).toBeNull();
    // Newest first: João's expense, then the two members joining.
    expect(feed.items.map((i) => i.action)).toEqual([
      "member_joined",
      "entry_recorded",
      "member_joined",
    ]);
    expect(feed.items[1]).toMatchObject({
      actor: { name: "João" },
      unread: true,
      entry: { amountCents: "15000", category: "Material" },
    });
    expect(new Date(feed.items[1]!.at).toISOString()).toBe(feed.items[1]!.at);
  });

  it("starts the next page before the given id", async () => {
    const s = await seed();
    const joao = await signIn(s.joao);
    const all = (
      await http().get("/activities").set("Cookie", joao).expect(200)
    ).body as FeedBody;
    const [first] = all.items;
    const after = (
      await http()
        .get(`/activities?before=${first!.id}`)
        .set("Cookie", joao)
        .expect(200)
    ).body as FeedBody;
    expect(after.items).toEqual([]);
  });

  it("answers 400 for a cursor that is not an id", async () => {
    const s = await seed();
    const joao = await signIn(s.joao);
    await http().get("/activities?before=abc").set("Cookie", joao).expect(400);
  });

  it("answers 401 without a session", async () => {
    await http().get("/activities").expect(401);
  });
});
