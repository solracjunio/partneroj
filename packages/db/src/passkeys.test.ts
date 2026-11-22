import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeCredentials,
  CHALLENGE_LIFETIME_MINUTES,
  createChallenge,
  PasskeyRefused,
  registerPasskey,
  type NewCredential,
  type PasskeyRefusal,
} from "./passkeys.js";
import {
  auditLog,
  credentials,
  members,
  partnerships,
  sessions,
  webauthnChallenges,
} from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  waitForALockWait,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";
import { hashToken } from "./tokens.js";

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

/** A partnership with one member, "Maria", signed in on one device. */
async function seedSession(): Promise<{ memberId: string; sessionId: string }> {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "Maria", role: "partner" })
    .returning();
  const [session] = await t.db
    .insert(sessions)
    .values({ memberId: member!.id, refreshTokenHash: base64url() })
    .returning();
  return { memberId: member!.id, sessionId: session!.id };
}

const newCredential = (): NewCredential => ({
  credentialId: base64url(),
  publicKey: base64url(),
  counter: 0,
  transports: ["internal", "hybrid"],
});

async function challengeRow(challenge: string) {
  const [row] = await t.db
    .select()
    .from(webauthnChallenges)
    .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)));
  return row!;
}

/** The reason registerPasskey refused, or "saved". */
async function outcome(
  input: Parameters<typeof registerPasskey>[1],
): Promise<PasskeyRefusal | "saved"> {
  try {
    await registerPasskey(app.db, input);
    return "saved";
  } catch (error) {
    if (error instanceof PasskeyRefused) return error.reason;
    throw error;
  }
}

const credentialsOf = (memberId: string) =>
  t.db.select().from(credentials).where(eq(credentials.memberId, memberId));

describe("createChallenge", () => {
  it("stores only the hash of a challenge to register, for the session", async () => {
    const { sessionId } = await seedSession();
    const challenge = await createChallenge(app.db, {
      purpose: "register",
      sessionId,
    });
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await challengeRow(challenge);
    expect(row.challengeHash).not.toBe(challenge);
    expect(row.purpose).toBe("register");
    expect(row.sessionId).toBe(sessionId);
    expect(row.usedAt).toBeNull();
  });

  it("makes a challenge to sign in for nobody yet", async () => {
    const row = await challengeRow(
      await createChallenge(app.db, { purpose: "login" }),
    );
    expect(row.purpose).toBe("login");
    expect(row.sessionId).toBeNull();
  });

  it(`expires in ${CHALLENGE_LIFETIME_MINUTES} minutes`, async () => {
    const row = await challengeRow(
      await createChallenge(app.db, { purpose: "login" }),
    );
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
      CHALLENGE_LIFETIME_MINUTES * 60_000,
    );
  });

  it("makes a new challenge each time", async () => {
    const first = await createChallenge(app.db, { purpose: "login" });
    const second = await createChallenge(app.db, { purpose: "login" });
    expect(first).not.toBe(second);
  });
});

describe("registerPasskey", () => {
  async function ready() {
    const session = await seedSession();
    const challenge = await createChallenge(app.db, {
      purpose: "register",
      sessionId: session.sessionId,
    });
    return { ...session, challenge, credential: newCredential() };
  }

  it("saves the passkey of the session's member and uses the challenge", async () => {
    const { memberId, sessionId, challenge, credential } = await ready();
    const { id } = await registerPasskey(app.db, {
      sessionId,
      challenge,
      credential,
    });

    const [row] = await credentialsOf(memberId);
    expect(row!.id).toBe(id);
    expect(row!.credentialId).toBe(credential.credentialId);
    expect(row!.publicKey).toBe(credential.publicKey);
    expect(row!.counter).toBe(0);
    expect(row!.transports).toEqual(["internal", "hybrid"]);
    expect((await challengeRow(challenge)).usedAt).not.toBeNull();
  });

  it("audits who registered it from which session, without the public key", async () => {
    const { memberId, sessionId, challenge, credential } = await ready();
    const { id } = await registerPasskey(app.db, {
      sessionId,
      challenge,
      credential,
    });
    const audit = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(memberId);
    expect(audit[0]!.action).toBe("credential.register");
    expect(audit[0]!.after).toEqual({
      sessionId,
      credentialId: credential.credentialId,
    });
  });

  it("refuses a challenge that was never made", async () => {
    const { sessionId, credential } = await ready();
    expect(
      await outcome({ sessionId, challenge: base64url(), credential }),
    ).toBe("challenge-not-usable");
  });

  it("refuses a challenge the second time", async () => {
    const { memberId, sessionId, challenge, credential } = await ready();
    await registerPasskey(app.db, { sessionId, challenge, credential });
    expect(
      await outcome({ sessionId, challenge, credential: newCredential() }),
    ).toBe("challenge-not-usable");
    expect(await credentialsOf(memberId)).toHaveLength(1);
  });

  it("refuses an expired challenge, saving nothing", async () => {
    const { memberId, sessionId, challenge, credential } = await ready();
    await t.db
      .update(webauthnChallenges)
      .set({
        createdAt: sql`now() - interval '6 minutes'`,
        expiresAt: sql`now() - interval '1 minute'`,
      })
      .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)));
    expect(await outcome({ sessionId, challenge, credential })).toBe(
      "challenge-not-usable",
    );
    expect(await credentialsOf(memberId)).toEqual([]);
  });

  it("refuses a challenge to sign in", async () => {
    const { sessionId, credential } = await ready();
    const challenge = await createChallenge(app.db, { purpose: "login" });
    expect(await outcome({ sessionId, challenge, credential })).toBe(
      "challenge-not-usable",
    );
  });

  it("refuses another session's challenge, even of the same member", async () => {
    const { memberId, challenge, credential } = await ready();
    const [other] = await t.db
      .insert(sessions)
      .values({ memberId, refreshTokenHash: base64url() })
      .returning();
    expect(await outcome({ sessionId: other!.id, challenge, credential })).toBe(
      "challenge-not-usable",
    );
    expect((await challengeRow(challenge)).usedAt).toBeNull();
  });

  it("refuses a credential id already saved, keeping the challenge", async () => {
    const first = await ready();
    await registerPasskey(app.db, first);
    const { memberId, sessionId, challenge } = await ready();
    const taken = {
      ...newCredential(),
      credentialId: first.credential.credentialId,
    };

    expect(await outcome({ sessionId, challenge, credential: taken })).toBe(
      "credential-taken",
    );
    expect((await challengeRow(challenge)).usedAt).toBeNull();
    expect(
      await outcome({ sessionId, challenge, credential: newCredential() }),
    ).toBe("saved");
    expect(await credentialsOf(memberId)).toHaveLength(1);
  });

  it("refuses the challenge when another answer uses it at the same time", async () => {
    const { memberId, sessionId, challenge, credential } = await ready();
    let pending: Promise<PasskeyRefusal | "saved"> | undefined;
    await t.db.transaction(async (tx) => {
      await tx
        .update(webauthnChallenges)
        .set({ usedAt: sql`now()` })
        .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)));
      pending = outcome({ sessionId, challenge, credential });
      await waitForALockWait(t);
    });
    expect(await pending).toBe("challenge-not-usable");
    expect(await credentialsOf(memberId)).toEqual([]);
  });
});

describe("activeCredentials", () => {
  async function save(sessionId: string): Promise<NewCredential> {
    const challenge = await createChallenge(app.db, {
      purpose: "register",
      sessionId,
    });
    const credential = newCredential();
    await registerPasskey(app.db, { sessionId, challenge, credential });
    return credential;
  }

  it("lists the member's passkeys, oldest first, without the revoked", async () => {
    const { memberId, sessionId } = await seedSession();
    const first = await save(sessionId);
    const revoked = await save(sessionId);
    const third = await save(sessionId);
    await t.db
      .update(credentials)
      .set({ revokedAt: sql`now()` })
      .where(eq(credentials.credentialId, revoked.credentialId));
    // Someone else's passkey stays out.
    await save((await seedSession()).sessionId);

    expect(await activeCredentials(app.db, memberId)).toEqual([
      { credentialId: first.credentialId, transports: ["internal", "hybrid"] },
      { credentialId: third.credentialId, transports: ["internal", "hybrid"] },
    ]);
  });

  it("is empty for a member without a passkey", async () => {
    const { memberId } = await seedSession();
    expect(await activeCredentials(app.db, memberId)).toEqual([]);
  });
});
