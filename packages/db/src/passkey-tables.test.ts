import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  credentials,
  members,
  partnerships,
  sessions,
  webauthnChallenges,
} from "./schema.js";
import {
  connectAsApp,
  pgErrorCode,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

// Migration 0017. Every statement runs as the app user, as in production.
let t: TestDatabase;
let app: AppConnection;
beforeAll(async () => {
  t = await startTestDatabase();
  app = await connectAsApp(t);
});
afterAll(async () => {
  await app?.db.$client.end();
  await t?.stop();
});

/** A fresh base64url value; a uuid without its dashes is one. */
const base64url = () => randomUUID().replaceAll("-", "");

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

/** A partnership with one member, "Maria", signed in on one device. */
async function seedSession(): Promise<{ memberId: string; sessionId: string }> {
  const [p] = await app.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [member] = await app.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "Maria", role: "partner" })
    .returning();
  const [session] = await app.db
    .insert(sessions)
    .values({ memberId: member!.id, refreshTokenHash: base64url() })
    .returning();
  return { memberId: member!.id, sessionId: session!.id };
}

describe("credentials", () => {
  const insert = async (
    overrides: Partial<typeof credentials.$inferInsert> = {},
  ) => {
    const { memberId } = await seedSession();
    return app.db
      .insert(credentials)
      .values({
        memberId,
        credentialId: base64url(),
        publicKey: base64url(),
        ...overrides,
      })
      .returning();
  };

  it("stores a passkey, not yet used nor revoked", async () => {
    const [row] = await insert();
    expect(row!.counter).toBe(0);
    expect(row!.transports).toEqual([]);
    expect(row!.lastUsedAt).toBeNull();
    expect(row!.revokedAt).toBeNull();
  });

  it("keeps the transports the browser gave", async () => {
    const [row] = await insert({ transports: ["internal", "hybrid"] });
    expect(row!.transports).toEqual(["internal", "hybrid"]);
  });

  // SQLSTATE 23505 unique_violation: the member is found by this id.
  it("refuses the same credential id twice, even for another member", async () => {
    const credentialId = base64url();
    await insert({ credentialId });
    expect(await pgErrorCode(insert({ credentialId }))).toBe("23505");
  });

  // SQLSTATE 23514 check_violation.
  it.each(["", "a+b", "a/b", "ab=="])(
    "refuses the credential id %j, not base64url",
    async (credentialId) => {
      expect(await pgErrorCode(insert({ credentialId }))).toBe("23514");
    },
  );

  it.each(["", "a+b", "a/b", "ab=="])(
    "refuses the public key %j, not base64url",
    async (publicKey) => {
      expect(await pgErrorCode(insert({ publicKey }))).toBe("23514");
    },
  );

  it.each([0, 4_294_967_295])("takes the counter %d", async (counter) => {
    const [row] = await insert({ counter });
    expect(row!.counter).toBe(counter);
  });

  it.each([-1, 4_294_967_296])("refuses the counter %d", async (counter) => {
    expect(await pgErrorCode(insert({ counter }))).toBe("23514");
  });

  // SQLSTATE 23503 foreign_key_violation.
  it("belongs to a member", async () => {
    const orphan = app.db.insert(credentials).values({
      memberId: randomUUID(),
      credentialId: base64url(),
      publicKey: base64url(),
    });
    expect(await pgErrorCode(orphan)).toBe("23503");
  });

  it("is revoked by the app", async () => {
    const [row] = await insert();
    const at = new Date("2027-02-01T12:00:00Z");
    const [revoked] = await app.db
      .update(credentials)
      .set({ revokedAt: at, lastUsedAt: at, counter: 1 })
      .where(eq(credentials.id, row!.id))
      .returning();
    expect(revoked!.revokedAt).toEqual(at);
  });

  // SQLSTATE 42501 insufficient_privilege: revoked, never deleted.
  it("is never deleted by the app", async () => {
    const [row] = await insert();
    expect(
      await pgErrorCode(
        app.db.delete(credentials).where(eq(credentials.id, row!.id)),
      ),
    ).toBe("42501");
  });
});

describe("webauthn_challenges", () => {
  const insert = (values: Partial<typeof webauthnChallenges.$inferInsert>) =>
    app.db
      .insert(webauthnChallenges)
      .values({
        challengeHash: base64url(),
        purpose: "login",
        expiresAt: minutes(5),
        ...values,
      })
      .returning();

  it("takes a challenge to register a passkey, for a session", async () => {
    const { sessionId } = await seedSession();
    const [row] = await insert({ purpose: "register", sessionId });
    expect(row!.sessionId).toBe(sessionId);
    expect(row!.usedAt).toBeNull();
  });

  it("takes a challenge to sign in, for nobody yet", async () => {
    const [row] = await insert({ purpose: "login" });
    expect(row!.sessionId).toBeNull();
  });

  it("refuses a challenge to register without a session", async () => {
    expect(await pgErrorCode(insert({ purpose: "register" }))).toBe("23514");
  });

  it("refuses a challenge to sign in with a session", async () => {
    const { sessionId } = await seedSession();
    expect(await pgErrorCode(insert({ purpose: "login", sessionId }))).toBe(
      "23514",
    );
  });

  it("refuses the same challenge twice", async () => {
    const challengeHash = base64url();
    await insert({ challengeHash });
    expect(await pgErrorCode(insert({ challengeHash }))).toBe("23505");
  });

  it("refuses a challenge that expires when it is made", async () => {
    const at = new Date("2027-02-01T12:00:00Z");
    const expired = insert({ createdAt: at, expiresAt: at });
    expect(await pgErrorCode(expired)).toBe("23514");
  });

  it("refuses a session that doesn't exist", async () => {
    const orphan = insert({ purpose: "register", sessionId: randomUUID() });
    expect(await pgErrorCode(orphan)).toBe("23503");
  });

  it("is used and then deleted by the app", async () => {
    const [row] = await insert({});
    const used = await app.db
      .update(webauthnChallenges)
      .set({ usedAt: sql`now()` })
      .where(eq(webauthnChallenges.id, row!.id))
      .returning();
    expect(used).toHaveLength(1);
    expect(
      await pgErrorCode(
        app.db
          .delete(webauthnChallenges)
          .where(eq(webauthnChallenges.id, row!.id)),
      ),
    ).toBe("no error");
  });
});
