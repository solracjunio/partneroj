import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  createInvite,
  credentials,
  hashToken,
  members,
  partnerships,
  sessions,
  webauthnChallenges,
} from "@partneroj/db";
import {
  type AppConnection,
  connectAsApp,
  startTestDatabase,
  type TestDatabase,
  waitForALockWait,
} from "@partneroj/db/testing";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.module.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { RECEIPT_STORAGE } from "../receipts/storage.js";
import { FakePasskey, type LoginAnswer } from "../testing/fake-passkey.js";
import { uuidBytes } from "./webauthn.js";

// The HTTP server type supertest accepts (its "supertest/types" subpath is not exported).
type App = Parameters<typeof request>[0];

let t: TestDatabase;
let conn: AppConnection;
let app: INestApplication<App>;

beforeAll(async () => {
  t = await startTestDatabase();
  conn = await connectAsApp(t);
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

/** The site of PUBLIC_URL in vitest.config.ts, as a phone would see it. */
const site = { rpID: "partneroj.test", origin: "https://partneroj.test" };

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";

/** What the register options carry that the fake phone reads. */
type RegistrationOptions = { challenge: string; user: { id: string } };

const SESSION_COOKIE = /^__Host-session=([A-Za-z0-9_-]{43});/;

/**
 * A member, "Maria", who joined by invite and registered a passkey from
 * the app, as in 2c: their id, that first cookie and the phone's passkey.
 * `counter` is what the phone sent when registering.
 */
async function withPasskey(counter = 0) {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "Maria", role: "partner" })
    .returning();
  const { token } = await createInvite(conn.db, {
    memberId: member!.id,
    createdBy: null,
  });
  const accepted = await http()
    .post(`/auth/invites/${token}/accept`)
    .expect(204);
  const cookie = cookieOf(accepted)!;

  const passkey = new FakePasskey();
  const options = await http()
    .post("/auth/passkeys/register/options")
    .set("Cookie", cookie)
    .expect(200);
  await http()
    .post("/auth/passkeys/register")
    .set("Cookie", cookie)
    .send(
      passkey.register(options.body as RegistrationOptions, {
        ...site,
        counter,
      }),
    )
    .expect(204);
  return { memberId: member!.id, cookie, passkey };
}

/** The session cookie a response set, as a Cookie header; or undefined. */
function cookieOf(response: { headers: Record<string, unknown> }) {
  const set = response.headers["set-cookie"] as string[] | undefined;
  return set?.[0]?.split(";")[0];
}

async function loginOptions(): Promise<{
  challenge: string;
  rpId: string;
  userVerification: string;
  allowCredentials?: unknown[];
}> {
  const response = await http()
    .post("/auth/passkeys/login/options")
    .expect(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  return response.body as Awaited<ReturnType<typeof loginOptions>>;
}

const login = (body: object) =>
  http()
    .post("/auth/passkeys/login")
    .set("User-Agent", ANDROID_CHROME)
    .send(body);

/** The phone's answer to new options, from the site unless changed. */
async function answer(passkey: FakePasskey, change: Partial<LoginAnswer> = {}) {
  return passkey.authenticate(await loginOptions(), { ...site, ...change });
}

const handleOf = (memberId: string) =>
  isoBase64URL.fromBuffer(uuidBytes(memberId));

const me = (cookie: string) => http().get("/me").set("Cookie", cookie);

describe("POST /auth/passkeys/login/options", () => {
  it("asks any phone, without a session, for a passkey with the fingerprint", async () => {
    const options = await loginOptions();
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(options.rpId).toBe("partneroj.test");
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials ?? []).toEqual([]);

    const [row] = await t.db
      .select()
      .from(webauthnChallenges)
      .where(
        eq(webauthnChallenges.challengeHash, hashToken(options.challenge)),
      );
    expect(row!.purpose).toBe("login");
  });
});

describe("POST /auth/passkeys/login", () => {
  it("signs the passkey's member in on this phone, with a new session", async () => {
    const { memberId, cookie: first, passkey } = await withPasskey();

    const response = await login(await answer(passkey)).expect(204);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["set-cookie"]![0]).toMatch(SESSION_COOKIE);
    const cookie = cookieOf(response)!;
    expect(cookie).not.toBe(first);
    const who = await me(cookie).expect(200);
    expect((who.body as { memberId: string }).memberId).toBe(memberId);

    const token = SESSION_COOKIE.exec(response.headers["set-cookie"]![0]!)![1]!;
    const [session] = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hashToken(token)));
    expect(session!.device).toBe("Android");
    expect(session!.browser).toBe("Chrome");
  });

  it("keeps the counter the phone signed", async () => {
    const { passkey } = await withPasskey(7);
    await login(await answer(passkey, { counter: 8 })).expect(204);
    const [row] = await t.db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialId, passkey.credentialId));
    expect(row!.counter).toBe(8);
  });

  it("refuses a passkey the API doesn't know: an invite is needed", async () => {
    const { memberId } = await withPasskey();
    const unknown = new FakePasskey();
    const response = await login(
      await answer(unknown, { userHandle: handleOf(memberId) }),
    ).expect(401);
    expect(response.body).toMatchObject({ message: "passkey_unknown" });
    expect(cookieOf(response)).toBeUndefined();
  });

  it("refuses a revoked passkey", async () => {
    const { passkey } = await withPasskey();
    await t.db
      .update(credentials)
      .set({ revokedAt: sql`now()` })
      .where(eq(credentials.credentialId, passkey.credentialId));
    const response = await login(await answer(passkey)).expect(401);
    expect(response.body).toMatchObject({ message: "passkey_unknown" });
  });

  it("refuses a signature by another key with the same passkey id", async () => {
    const { memberId, passkey } = await withPasskey();
    const copy = new FakePasskey(passkey.credentialId);
    const response = await login(
      await answer(copy, { userHandle: handleOf(memberId) }),
    ).expect(400);
    expect(response.body).toMatchObject({ message: "passkey_not_verified" });
    expect(cookieOf(response)).toBeUndefined();
  });

  it("refuses a user handle that isn't the passkey's member", async () => {
    const { passkey } = await withPasskey();
    const { memberId: other } = await withPasskey();
    const response = await login(
      await answer(passkey, { userHandle: handleOf(other) }),
    ).expect(400);
    expect(response.body).toMatchObject({ message: "passkey_not_verified" });
  });

  it.each<{ when: string; change: Partial<LoginAnswer> }>([
    { when: "another site", change: { rpID: "outro.test" } },
    { when: "another page", change: { origin: "https://outro.test" } },
    { when: "no fingerprint, only a tap", change: { userVerified: false } },
  ])("refuses an answer from $when", async ({ change }) => {
    const { passkey } = await withPasskey();
    const response = await login(await answer(passkey, change)).expect(400);
    expect(response.body).toMatchObject({ message: "passkey_not_verified" });
  });

  it("refuses a counter that didn't go up", async () => {
    const { passkey } = await withPasskey(5);
    const response = await login(await answer(passkey, { counter: 5 })).expect(
      400,
    );
    expect(response.body).toMatchObject({ message: "passkey_not_verified" });
  });

  it("refuses a challenge the API never made", async () => {
    const { passkey } = await withPasskey();
    const response = await login(
      await answer(passkey, { challenge: "bm90LXNlbnQ" }),
    ).expect(400);
    expect(response.body).toMatchObject({ message: "challenge_not_usable" });
  });

  it("refuses the same answer the second time", async () => {
    const { passkey } = await withPasskey();
    const body = await answer(passkey);
    await login(body).expect(204);
    const response = await login(body).expect(400);
    expect(response.body).toMatchObject({ message: "challenge_not_usable" });
    expect(cookieOf(response)).toBeUndefined();
  });

  it("refuses a challenge to register", async () => {
    const { cookie, passkey } = await withPasskey();
    const options = await http()
      .post("/auth/passkeys/register/options")
      .set("Cookie", cookie)
      .expect(200);
    const response = await login(
      passkey.authenticate(options.body as RegistrationOptions, site),
    ).expect(400);
    expect(response.body).toMatchObject({ message: "challenge_not_usable" });
  });

  it("refuses the second of two sign-ins with the same counter", async () => {
    const { passkey } = await withPasskey();
    const body = await answer(passkey, { counter: 5 });
    let pending: Promise<request.Response> | undefined;
    // The first sign-in holds the passkey's row: its counter is 5 now.
    await t.db.transaction(async (tx) => {
      await tx
        .update(credentials)
        .set({ counter: 5 })
        .where(eq(credentials.credentialId, passkey.credentialId));
      pending = login(body).then((response) => response);
      await waitForALockWait(t);
    });
    const response = await pending!;
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ message: "passkey_unknown" });
  });

  it("refuses a body that isn't a passkey's answer", async () => {
    const response = await login({ id: "x" }).expect(400);
    expect(response.body).toMatchObject({ message: "invalid_body" });
  });
});
