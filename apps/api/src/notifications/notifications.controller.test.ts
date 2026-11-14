import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  createDatabase,
  createInvite,
  createPartnership,
  type Database,
  installJobQueue,
  type PgBoss,
  pushSubscriptions,
  sessions,
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
import { VAPID_PUBLIC_KEY } from "./vapid.js";

// The HTTP server type supertest accepts (its "supertest/types" subpath is not exported).
type App = Parameters<typeof request>[0];

const publicKey = "BPublicKeyForTestsOnly";

let t: TestDatabase;
let conn: AppConnection;
let boss: PgBoss;
let app: INestApplication<App>;
let appWithoutKey: INestApplication<App>;

/** Each app ends its own database pool when it closes. */
async function buildApp(
  db: Database,
  key: string | null,
): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(JOB_QUEUE)
    .useValue(boss)
    .overrideProvider(RECEIPT_STORAGE)
    .useValue({})
    .overrideProvider(VAPID_PUBLIC_KEY)
    .useValue(key)
    .compile();
  const built = moduleRef.createNestApplication<INestApplication<App>>();
  await built.init();
  return built;
}

beforeAll(async () => {
  t = await startTestDatabase();
  await installJobQueue(t.connectionString);
  conn = await connectAsApp(t);
  boss = await startJobQueue(conn.connectionString, { sendOnly: true });
  app = await buildApp(conn.db, publicKey);
  appWithoutKey = await buildApp(createDatabase(conn.connectionString), null);
});

afterAll(async () => {
  await appWithoutKey?.close();
  await app?.close();
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

/** João and Maria (admins) and Leo (reader). */
async function seed() {
  const p = await createPartnership(conn.db, {
    name: "Obra Teste",
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, , leo] = p.members.map((m) => m.id) as [string, string, string];
  return { joao, leo };
}

let counter = 0;
/** What PushSubscription.toJSON() gives, with an endpoint of its own. */
function browserSubscription() {
  counter += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/api-test-${counter}`,
    expirationTime: null,
    keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  };
}

/** The endpoints stored for a member's sessions. */
async function endpointsOf(memberId: string): Promise<string[]> {
  const rows = await conn.db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .innerJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId))
    .where(eq(sessions.memberId, memberId));
  return rows.map((r) => r.endpoint);
}

describe("GET /notifications/vapid-key", () => {
  it("answers the public key to a signed-in member", async () => {
    const { joao } = await seed();
    const cookie = await signIn(joao);

    const response = await http()
      .get("/notifications/vapid-key")
      .set("Cookie", cookie)
      .expect(200);

    expect(response.body).toEqual({ publicKey });
  });

  it("answers 503 when the server has no key", async () => {
    const { joao } = await seed();
    const cookie = await signIn(joao);

    const response = await request(appWithoutKey.getHttpServer())
      .get("/notifications/vapid-key")
      .set("Cookie", cookie)
      .expect(503);

    expect(response.body).toMatchObject({ message: "push_not_configured" });
  });

  it("asks for a session", async () => {
    await http().get("/notifications/vapid-key").expect(401);
  });
});

describe("PUT /notifications/subscription", () => {
  it("stores the subscription of the member's session", async () => {
    const { joao } = await seed();
    const cookie = await signIn(joao);
    const sub = browserSubscription();

    await http()
      .put("/notifications/subscription")
      .set("Cookie", cookie)
      .send(sub)
      .expect(204);

    expect(await endpointsOf(joao)).toEqual([sub.endpoint]);
  });

  it("lets a reader subscribe: every member is notified", async () => {
    const { leo } = await seed();
    const cookie = await signIn(leo);
    const sub = browserSubscription();

    await http()
      .put("/notifications/subscription")
      .set("Cookie", cookie)
      .send(sub)
      .expect(204);

    expect(await endpointsOf(leo)).toEqual([sub.endpoint]);
  });

  it("refuses an endpoint off the known push services", async () => {
    const { joao } = await seed();
    const cookie = await signIn(joao);
    const sub = { ...browserSubscription(), endpoint: "https://example.com/x" };

    const response = await http()
      .put("/notifications/subscription")
      .set("Cookie", cookie)
      .send(sub)
      .expect(400);

    expect(response.body).toMatchObject({
      message: "invalid_body",
      fields: ["endpoint"],
    });
    expect(await endpointsOf(joao)).toEqual([]);
  });

  it("asks for a session", async () => {
    await http()
      .put("/notifications/subscription")
      .send(browserSubscription())
      .expect(401);
  });
});

describe("DELETE /notifications/subscription", () => {
  it("removes this session's subscription and keeps the other phone's", async () => {
    const { joao } = await seed();
    const phone = await signIn(joao);
    const otherPhone = await signIn(joao);
    const mine = browserSubscription();
    const other = browserSubscription();
    await http()
      .put("/notifications/subscription")
      .set("Cookie", phone)
      .send(mine)
      .expect(204);
    await http()
      .put("/notifications/subscription")
      .set("Cookie", otherPhone)
      .send(other)
      .expect(204);

    await http()
      .delete("/notifications/subscription")
      .set("Cookie", phone)
      .expect(204);

    expect(await endpointsOf(joao)).toEqual([other.endpoint]);
  });

  it("asks for a session", async () => {
    await http().delete("/notifications/subscription").expect(401);
  });
});
