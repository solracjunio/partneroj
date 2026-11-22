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
  webauthnChallenges,
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
import { type Answer, FakePasskey } from "../testing/fake-passkey.js";

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
const site: Answer = {
  rpID: "partneroj.test",
  origin: "https://partneroj.test",
};

/** A member of a new partnership, signed in: their id and Cookie header. */
async function signedIn(
  role: "admin" | "partner" | "reader" = "partner",
): Promise<{ memberId: string; cookie: string }> {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "Maria", role })
    .returning();
  const { token } = await createInvite(conn.db, {
    memberId: member!.id,
    createdBy: null,
  });
  const response = await http()
    .post(`/auth/invites/${token}/accept`)
    .expect(204);
  const [setCookie] = response.headers["set-cookie"] as unknown as string[];
  return { memberId: member!.id, cookie: setCookie!.split(";")[0]! };
}

interface Options {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  attestation: string;
  authenticatorSelection: { residentKey: string; userVerification: string };
  excludeCredentials: { id: string; type: string; transports?: string[] }[];
}

async function optionsFor(cookie: string): Promise<Options> {
  const response = await http()
    .post("/auth/passkeys/register/options")
    .set("Cookie", cookie)
    .expect(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  return response.body as Options;
}

const register = (cookie: string, body: object) =>
  http().post("/auth/passkeys/register").set("Cookie", cookie).send(body);

const passkeysOf = (memberId: string) =>
  t.db.select().from(credentials).where(eq(credentials.memberId, memberId));

const hasPasskey = async (cookie: string) =>
  (
    (await http().get("/me").set("Cookie", cookie).expect(200)).body as {
      hasPasskey: boolean;
    }
  ).hasPasskey;

describe("POST /auth/passkeys/register/options", () => {
  it("asks for a discoverable passkey with the fingerprint, for this site", async () => {
    const { memberId, cookie } = await signedIn();
    const options = await optionsFor(cookie);
    expect(options.rp).toEqual({ id: "partneroj.test", name: "Partneroj" });
    expect(options.user.name).toBe("Maria");
    expect(options.user.displayName).toBe("Maria");
    // The member's id as 16 bytes: opaque, the same on every phone.
    expect(Buffer.from(options.user.id, "base64url").toString("hex")).toBe(
      memberId.replaceAll("-", ""),
    );
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    expect(options.excludeCredentials).toEqual([]);
  });

  it("sends the challenge it stored, for this session", async () => {
    const { cookie } = await signedIn();
    const { challenge } = await optionsFor(cookie);
    const [row] = await t.db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)));
    expect(row!.purpose).toBe("register");
    expect(row!.sessionId).not.toBeNull();
  });

  it("works for a reader too: everyone signs in", async () => {
    const { cookie } = await signedIn("reader");
    await optionsFor(cookie);
  });

  it("answers 401 without a session", async () => {
    await http().post("/auth/passkeys/register/options").expect(401);
  });
});

describe("POST /auth/passkeys/register", () => {
  it("saves the passkey, and /me then says so", async () => {
    const { memberId, cookie } = await signedIn();
    expect(await hasPasskey(cookie)).toBe(false);
    const passkey = new FakePasskey();

    await register(
      cookie,
      passkey.register(await optionsFor(cookie), site),
    ).expect(204);

    const [row] = await passkeysOf(memberId);
    expect(row!.credentialId).toBe(passkey.credentialId);
    expect(row!.publicKey).toBe(passkey.publicKey);
    expect(row!.counter).toBe(0);
    expect(row!.transports).toEqual(["internal", "hybrid"]);
    expect(await hasPasskey(cookie)).toBe(true);
  });

  it("keeps a security key's counter, and no transports when none came", async () => {
    const { memberId, cookie } = await signedIn();
    const options = await optionsFor(cookie);
    await register(
      cookie,
      new FakePasskey().register(options, {
        ...site,
        counter: 7,
        transports: null,
      }),
    ).expect(204);
    const [row] = await passkeysOf(memberId);
    expect(row!.counter).toBe(7);
    expect(row!.transports).toEqual([]);
  });

  it("then tells the phone which passkey it already has", async () => {
    const { cookie } = await signedIn();
    const passkey = new FakePasskey();
    await register(
      cookie,
      passkey.register(await optionsFor(cookie), site),
    ).expect(204);
    expect((await optionsFor(cookie)).excludeCredentials).toEqual([
      {
        id: passkey.credentialId,
        type: "public-key",
        transports: ["internal", "hybrid"],
      },
    ]);
  });

  it.each<[string, Partial<Answer>]>([
    ["another site's page", { origin: "https://partneroj.example" }],
    ["a passkey for another domain", { rpID: "partneroj.example" }],
    ["a tap instead of the fingerprint", { userVerified: false }],
  ])("answers 400 for %s, saving nothing", async (_case, change) => {
    const { memberId, cookie } = await signedIn();
    const options = await optionsFor(cookie);
    const response = await register(
      cookie,
      new FakePasskey().register(options, { ...site, ...change }),
    ).expect(400);
    expect(response.body).toMatchObject({ message: "passkey_not_verified" });
    expect(await passkeysOf(memberId)).toEqual([]);
  });

  it("answers 400 for a challenge the API never sent", async () => {
    const { cookie } = await signedIn();
    await optionsFor(cookie);
    const response = await register(
      cookie,
      new FakePasskey().register({ challenge: "bm90LXNlbnQ" }, site),
    ).expect(400);
    expect(response.body).toMatchObject({ message: "challenge_not_usable" });
  });

  it("answers 400 the second time the same answer comes", async () => {
    const { memberId, cookie } = await signedIn();
    const answer = new FakePasskey().register(await optionsFor(cookie), site);
    await register(cookie, answer).expect(204);
    const response = await register(cookie, answer).expect(400);
    expect(response.body).toMatchObject({ message: "challenge_not_usable" });
    expect(await passkeysOf(memberId)).toHaveLength(1);
  });

  it("answers 400 for an answer to another session's challenge", async () => {
    const first = await signedIn();
    const second = await signedIn();
    const answer = new FakePasskey().register(
      await optionsFor(first.cookie),
      site,
    );
    const response = await register(second.cookie, answer).expect(400);
    expect(response.body).toMatchObject({ message: "challenge_not_usable" });
    expect(await passkeysOf(second.memberId)).toEqual([]);
  });

  it("answers 409 for a passkey id another member already has", async () => {
    const first = await signedIn();
    const second = await signedIn();
    const original = new FakePasskey();
    await register(
      first.cookie,
      original.register(await optionsFor(first.cookie), site),
    ).expect(204);

    const copy = new FakePasskey(original.credentialId);
    const response = await register(
      second.cookie,
      copy.register(await optionsFor(second.cookie), site),
    ).expect(409);
    expect(response.body).toMatchObject({ message: "credential_taken" });
  });

  it("answers 400 for a body that is not a passkey", async () => {
    const { cookie } = await signedIn();
    const response = await register(cookie, { id: "x" }).expect(400);
    expect(response.body).toMatchObject({ message: "invalid_body" });
  });

  it("answers 401 without a session", async () => {
    await http().post("/auth/passkeys/register").send({}).expect(401);
  });
});
