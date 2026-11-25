import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createInvite, members, partnerships } from "@partneroj/db";
import {
  type AppConnection,
  connectAsApp,
  startTestDatabase,
  type TestDatabase,
  waitForALockWait,
} from "@partneroj/db/testing";
import { and, eq } from "drizzle-orm";
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
let app: INestApplication<App>;

beforeAll(async () => {
  t = await startTestDatabase();
  conn = await connectAsApp(t);
  // The API connects as the app role, as in production.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // Signs in many times a second; the limit has its own test (throttle.test.ts).
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .overrideProvider(DATABASE)
    .useValue(conn.db)
    // These routes queue no jobs.
    .overrideProvider(JOB_QUEUE)
    .useValue({ stop: () => Promise.resolve() })
    .overrideProvider(RECEIPT_STORAGE)
    .useValue({})
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close(); // Also ends conn.db's pool (DatabaseModule).
  await t?.stop();
});

const http = () => request(app.getHttpServer());

type Role = (typeof members.$inferSelect)["role"];

/**
 * A partnership with 2 admins, João and Maria, a partner, Bruno, and a
 * reader, Caio; `ana` adds a third admin.
 */
async function newPartnership(options: { ana?: boolean } = {}) {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const people: { name: string; role: Role }[] = [
    { name: "João", role: "admin" },
    { name: "Maria", role: "admin" },
    ...(options.ana ? [{ name: "Ana", role: "admin" as const }] : []),
    { name: "Bruno", role: "partner" },
    { name: "Caio", role: "reader" },
  ];
  const rows = await t.db
    .insert(members)
    .values(people.map((m) => ({ ...m, partnershipId: p!.id })))
    .returning();
  const id = (name: string) => rows.find((m) => m.name === name)?.id ?? "";
  return {
    partnershipId: p!.id,
    joao: id("João"),
    maria: id("Maria"),
    ana: id("Ana"),
    bruno: id("Bruno"),
    caio: id("Caio"),
  };
}

/** Signs the member in through an invite; returns the Cookie header. */
async function signIn(memberId: string): Promise<string> {
  const { token } = await createInvite(conn.db, { memberId, createdBy: null });
  const response = await http()
    .post(`/auth/invites/${token}/accept`)
    .expect(204);
  const [first] = response.headers["set-cookie"] as unknown as string[];
  return first!.split(";")[0]!;
}

const setRole = (cookie: string, memberId: string, role: unknown) =>
  http().post(`/members/${memberId}/role`).set("Cookie", cookie).send({ role });

async function roleOf(memberId: string): Promise<Role | undefined> {
  const [m] = await t.db
    .select({ role: members.role })
    .from(members)
    .where(eq(members.id, memberId));
  return m?.role;
}

describe("POST /members/:memberId/role", () => {
  it("lets an admin make a partner an admin", async () => {
    const s = await newPartnership();
    const cookie = await signIn(s.joao);

    await setRole(cookie, s.bruno, "admin").expect(204);
    expect(await roleOf(s.bruno)).toBe("admin");
  });

  it("lets an admin step down while 2 admins remain", async () => {
    const s = await newPartnership({ ana: true });
    const cookie = await signIn(s.ana);

    await setRole(cookie, s.ana, "partner").expect(204);
    expect(await roleOf(s.ana)).toBe("partner");
  });

  it("answers 204 for the same role again: a double tap is not an error", async () => {
    const s = await newPartnership();
    const cookie = await signIn(s.joao);

    await setRole(cookie, s.maria, "admin").expect(204);
  });

  it("refuses to leave fewer than 2 admins", async () => {
    const s = await newPartnership();
    const cookie = await signIn(s.joao);

    const response = await setRole(cookie, s.maria, "partner").expect(409);
    expect(response.body).toMatchObject({ message: "too_few_admins" });
    expect(await roleOf(s.maria)).toBe("admin");
  });

  it("refuses a reader's role: who votes changes only by a ballot", async () => {
    const s = await newPartnership();
    const cookie = await signIn(s.joao);

    const response = await setRole(cookie, s.caio, "partner").expect(409);
    expect(response.body).toMatchObject({ message: "role_needs_ballot" });
    expect(await roleOf(s.caio)).toBe("reader");
  });

  it.each([
    { what: "reader", role: "reader" },
    { what: "no role", role: undefined },
  ])("refuses a body with $what", async ({ role }) => {
    const s = await newPartnership();
    const cookie = await signIn(s.joao);

    const response = await setRole(cookie, s.bruno, role).expect(400);
    expect(response.body).toMatchObject({ message: "invalid_body" });
  });

  it("refuses a partner, for any id", async () => {
    const s = await newPartnership();
    const cookie = await signIn(s.bruno);

    await setRole(cookie, s.bruno, "admin").expect(403);
    await setRole(cookie, "not-a-uuid", "admin").expect(403);
    expect(await roleOf(s.bruno)).toBe("partner");
  });

  it("refuses an admin demoted while the change waited on the lock", async () => {
    const s = await newPartnership({ ana: true });
    const cookie = await signIn(s.joao);
    let pending: Promise<request.Response> | undefined;
    // Maria demotes João, holding the admins as changeRole does. The
    // session check already read João as an admin.
    await t.db.transaction(async (tx) => {
      await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.partnershipId, s.partnershipId),
            eq(members.role, "admin"),
          ),
        )
        .for("update");
      await tx
        .update(members)
        .set({ role: "partner" })
        .where(eq(members.id, s.joao));
      pending = setRole(cookie, s.maria, "partner").then((r) => r);
      await waitForALockWait(t);
    });

    expect((await pending!).status).toBe(403);
    expect(await roleOf(s.maria)).toBe("admin");
  });

  it("answers 404 for a member of another partnership", async () => {
    const mine = await newPartnership();
    const theirs = await newPartnership();
    const cookie = await signIn(mine.joao);

    await setRole(cookie, theirs.bruno, "admin").expect(404);
    expect(await roleOf(theirs.bruno)).toBe("partner");
  });

  it("answers 404 for an id that is not a uuid", async () => {
    const s = await newPartnership();
    const cookie = await signIn(s.joao);

    await setRole(cookie, "not-a-uuid", "admin").expect(404);
  });

  it("refuses without a session", async () => {
    const s = await newPartnership();

    await http()
      .post(`/members/${s.bruno}/role`)
      .send({ role: "admin" })
      .expect(401);
  });
});
