import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createInvite, members, partnerships, sessions } from "@partneroj/db";
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
    .overrideProvider(DATABASE)
    .useValue(conn.db)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close(); // Also ends conn.db's pool (DatabaseModule).
  await t?.stop();
});

const http = () => request(app.getHttpServer());

/** A partnership with an admin and a partner, each with an invite. */
async function newPartnership(name = "Obra Teste") {
  const [p] = await t.db.insert(partnerships).values({ name }).returning();
  const [admin, partner] = await t.db
    .insert(members)
    .values([
      { partnershipId: p!.id, name: "João", role: "admin" },
      { partnershipId: p!.id, name: "Maria", role: "partner" },
    ])
    .returning();
  const invite = async (memberId: string) =>
    (await createInvite(conn.db, { memberId, createdBy: null })).token;
  return {
    admin: { id: admin!.id, token: await invite(admin!.id) },
    partner: { id: partner!.id, token: await invite(partner!.id) },
  };
}

/** Taps the invite's button; returns the Cookie header to send back. */
async function signIn(inviteToken: string): Promise<string> {
  const response = await http()
    .post(`/auth/invites/${inviteToken}/accept`)
    .expect(204);
  return cookieOf(response.headers["set-cookie"]);
}

/** "name=value" from a Set-Cookie header, ready for a Cookie header. */
function cookieOf(setCookie: unknown): string {
  const [first] = setCookie as string[];
  return first!.split(";")[0]!;
}

describe("GET /invites/:token", () => {
  it("shows who the invite is for, as often as it is opened", async () => {
    const { partner } = await newPartnership();
    for (let i = 0; i < 2; i++) {
      const response = await http()
        .get(`/invites/${partner.token}`)
        .expect(200);
      expect(response.body).toEqual({
        memberName: "Maria",
        partnershipName: "Obra Teste",
      });
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("answers 404 for a token that is not an invite", async () => {
    await http()
      .get(`/invites/${"x".repeat(43)}`)
      .expect(404);
    await http().get("/invites/short").expect(404);
  });
});

describe("POST /auth/invites/:token/accept", () => {
  it("sets a session cookie the page can't read", async () => {
    const { partner } = await newPartnership();
    const response = await http()
      .post(`/auth/invites/${partner.token}/accept`)
      .set(
        "User-Agent",
        "Mozilla/5.0 (Linux; Android 15) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      )
      .expect(204);
    const [cookie] = response.headers["set-cookie"] as unknown as string[];
    expect(cookie).toMatch(/^__Host-session=[A-Za-z0-9_-]{43}; /);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");

    const [session] = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.memberId, partner.id));
    expect(session).toMatchObject({
      device: "Android",
      browser: "Samsung Internet",
    });
  });

  it("answers 404 the second time", async () => {
    const { partner } = await newPartnership();
    await signIn(partner.token);
    await http().post(`/auth/invites/${partner.token}/accept`).expect(404);
  });
});

describe("GET /me", () => {
  it("returns the member of the session and renews the cookie", async () => {
    const { partner } = await newPartnership();
    const cookie = await signIn(partner.token);
    const response = await http().get("/me").set("Cookie", cookie).expect(200);
    expect(response.body).toMatchObject({
      memberId: partner.id,
      name: "Maria",
      role: "partner",
    });
    expect(cookieOf(response.headers["set-cookie"])).toBe(cookie);
  });

  it("answers 401 without a session", async () => {
    await http().get("/me").expect(401);
    await http()
      .get("/me")
      .set("Cookie", `__Host-session=${"x".repeat(43)}`)
      .expect(401);
  });
});

describe("POST /members/:memberId/sessions/revoke", () => {
  it("lets an admin end a member's sessions", async () => {
    const { admin, partner } = await newPartnership();
    const adminCookie = await signIn(admin.token);
    const partnerCookie = await signIn(partner.token);

    const response = await http()
      .post(`/members/${partner.id}/sessions/revoke`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(response.body).toEqual({ revoked: 1 });
    await http().get("/me").set("Cookie", partnerCookie).expect(401);
  });

  it("refuses a partner who is not an admin", async () => {
    const { admin, partner } = await newPartnership();
    const adminCookie = await signIn(admin.token);
    const partnerCookie = await signIn(partner.token);

    await http()
      .post(`/members/${admin.id}/sessions/revoke`)
      .set("Cookie", partnerCookie)
      .expect(403);
    await http().get("/me").set("Cookie", adminCookie).expect(200);
  });

  it("can't reach a member of another partnership", async () => {
    const ours = await newPartnership();
    const theirs = await newPartnership("Outra Obra");
    const adminCookie = await signIn(ours.admin.token);
    const theirCookie = await signIn(theirs.partner.token);

    await http()
      .post(`/members/${theirs.partner.id}/sessions/revoke`)
      .set("Cookie", adminCookie)
      .expect(404);
    await http().get("/me").set("Cookie", theirCookie).expect(200);
  });
});
