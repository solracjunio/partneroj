import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createChallenge,
  deleteStaleChallenges,
  findCredential,
  PasskeyRefused,
  type PasskeyRefusal,
  signInWithPasskey,
  STALE_CHALLENGE_DAYS,
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

/**
 * A member, "Maria", with a saved passkey whose counter is `counter`,
 * signed out: no session yet.
 */
async function seedPasskey(counter = 0) {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "Maria", role: "partner" })
    .returning();
  const [passkey] = await t.db
    .insert(credentials)
    .values({
      memberId: member!.id,
      credentialId: base64url(),
      publicKey: base64url(),
      counter,
      transports: ["internal", "hybrid"],
    })
    .returning();
  return { memberId: member!.id, passkey: passkey! };
}

const loginChallenge = () => createChallenge(app.db, { purpose: "login" });

async function challengeRow(challenge: string) {
  const [row] = await t.db
    .select()
    .from(webauthnChallenges)
    .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)));
  return row!;
}

async function passkeyRow(credentialId: string) {
  const [row] = await t.db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, credentialId));
  return row!;
}

const sessionsOf = (memberId: string) =>
  t.db.select().from(sessions).where(eq(sessions.memberId, memberId));

/** The reason signInWithPasskey refused, or "in". */
async function outcome(
  input: Parameters<typeof signInWithPasskey>[1],
): Promise<PasskeyRefusal | "in"> {
  try {
    await signInWithPasskey(app.db, input);
    return "in";
  } catch (error) {
    if (error instanceof PasskeyRefused) return error.reason;
    throw error;
  }
}

describe("findCredential", () => {
  it("finds a passkey by the id the phone sent, with its key", async () => {
    const { memberId, passkey } = await seedPasskey(7);
    expect(await findCredential(app.db, passkey.credentialId)).toEqual({
      id: passkey.id,
      memberId,
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: 7,
      transports: ["internal", "hybrid"],
    });
  });

  it("finds nothing for an unknown id", async () => {
    await seedPasskey();
    expect(await findCredential(app.db, base64url())).toBeNull();
  });

  it("finds nothing for a revoked passkey", async () => {
    const { passkey } = await seedPasskey();
    await t.db
      .update(credentials)
      .set({ revokedAt: sql`now()` })
      .where(eq(credentials.id, passkey.id));
    expect(await findCredential(app.db, passkey.credentialId)).toBeNull();
  });
});

describe("signInWithPasskey", () => {
  it("opens a session for the passkey's member and uses the challenge", async () => {
    const { memberId, passkey } = await seedPasskey();
    const challenge = await loginChallenge();

    const signedIn = await signInWithPasskey(app.db, {
      challenge,
      credentialId: passkey.credentialId,
      counter: 0,
      device: { device: "Android", browser: "Chrome" },
    });

    expect(signedIn.memberId).toBe(memberId);
    const [session] = await sessionsOf(memberId);
    expect(session!.id).toBe(signedIn.sessionId);
    expect(session!.refreshTokenHash).toBe(hashToken(signedIn.sessionToken));
    expect(session!.device).toBe("Android");
    expect(session!.browser).toBe("Chrome");
    expect((await challengeRow(challenge)).usedAt).not.toBeNull();
    expect((await passkeyRow(passkey.credentialId)).lastUsedAt).not.toBeNull();
  });

  it("audits the sign-in, with the session and the device", async () => {
    const { memberId, passkey } = await seedPasskey();
    const { sessionId } = await signInWithPasskey(app.db, {
      challenge: await loginChallenge(),
      credentialId: passkey.credentialId,
      counter: 0,
      device: { device: "Android", browser: "Chrome" },
    });
    const audit = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, passkey.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(memberId);
    expect(audit[0]!.action).toBe("credential.login");
    expect(audit[0]!.after).toEqual({ sessionId, device: "Android" });
  });

  it("opens a session without a device when the browser said nothing", async () => {
    const { memberId, passkey } = await seedPasskey();
    await signInWithPasskey(app.db, {
      challenge: await loginChallenge(),
      credentialId: passkey.credentialId,
      counter: 0,
    });
    const [session] = await sessionsOf(memberId);
    expect(session!.device).toBeNull();
    expect(session!.browser).toBeNull();
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, passkey.id));
    expect(audit!.after).toEqual({ sessionId: session!.id, device: null });
  });

  it("keeps the counter of the signed answer", async () => {
    const { passkey } = await seedPasskey(5);
    expect(
      await outcome({
        challenge: await loginChallenge(),
        credentialId: passkey.credentialId,
        counter: 6,
      }),
    ).toBe("in");
    expect((await passkeyRow(passkey.credentialId)).counter).toBe(6);
  });

  it("refuses a challenge that was never made", async () => {
    const { memberId, passkey } = await seedPasskey();
    expect(
      await outcome({
        challenge: base64url(),
        credentialId: passkey.credentialId,
        counter: 0,
      }),
    ).toBe("challenge-not-usable");
    expect(await sessionsOf(memberId)).toEqual([]);
  });

  it("refuses a challenge the second time", async () => {
    const { memberId, passkey } = await seedPasskey();
    const challenge = await loginChallenge();
    const input = { challenge, credentialId: passkey.credentialId, counter: 0 };
    expect(await outcome(input)).toBe("in");
    expect(await outcome(input)).toBe("challenge-not-usable");
    expect(await sessionsOf(memberId)).toHaveLength(1);
  });

  it("refuses an expired challenge", async () => {
    const { passkey } = await seedPasskey();
    const challenge = await loginChallenge();
    await t.db
      .update(webauthnChallenges)
      .set({
        createdAt: sql`now() - interval '6 minutes'`,
        expiresAt: sql`now() - interval '1 minute'`,
      })
      .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)));
    expect(
      await outcome({
        challenge,
        credentialId: passkey.credentialId,
        counter: 0,
      }),
    ).toBe("challenge-not-usable");
  });

  it("refuses a challenge to register", async () => {
    const { memberId, passkey } = await seedPasskey();
    const [session] = await t.db
      .insert(sessions)
      .values({ memberId, refreshTokenHash: base64url() })
      .returning();
    const challenge = await createChallenge(app.db, {
      purpose: "register",
      sessionId: session!.id,
    });
    expect(
      await outcome({
        challenge,
        credentialId: passkey.credentialId,
        counter: 0,
      }),
    ).toBe("challenge-not-usable");
    expect((await challengeRow(challenge)).usedAt).toBeNull();
  });

  it("refuses an unknown passkey, keeping the challenge", async () => {
    const challenge = await loginChallenge();
    expect(
      await outcome({ challenge, credentialId: base64url(), counter: 0 }),
    ).toBe("passkey-not-usable");
    expect((await challengeRow(challenge)).usedAt).toBeNull();
  });

  it("refuses a passkey revoked since the API found it", async () => {
    const { memberId, passkey } = await seedPasskey();
    await t.db
      .update(credentials)
      .set({ revokedAt: sql`now()` })
      .where(eq(credentials.id, passkey.id));
    expect(
      await outcome({
        challenge: await loginChallenge(),
        credentialId: passkey.credentialId,
        counter: 0,
      }),
    ).toBe("passkey-not-usable");
    expect(await sessionsOf(memberId)).toEqual([]);
  });

  it.each([
    { saved: 5, sent: 5 },
    { saved: 5, sent: 4 },
    { saved: 5, sent: 0 },
  ])(
    "refuses a counter that didn't go up ($saved, then $sent)",
    async ({ saved, sent }) => {
      const { memberId, passkey } = await seedPasskey(saved);
      expect(
        await outcome({
          challenge: await loginChallenge(),
          credentialId: passkey.credentialId,
          counter: sent,
        }),
      ).toBe("passkey-not-usable");
      expect((await passkeyRow(passkey.credentialId)).counter).toBe(saved);
      expect(await sessionsOf(memberId)).toEqual([]);
    },
  );

  it("lets a synced passkey, always 0, in every time", async () => {
    const { memberId, passkey } = await seedPasskey(0);
    for (let i = 0; i < 2; i++) {
      expect(
        await outcome({
          challenge: await loginChallenge(),
          credentialId: passkey.credentialId,
          counter: 0,
        }),
      ).toBe("in");
    }
    expect(await sessionsOf(memberId)).toHaveLength(2);
  });

  it("refuses the second of two sign-ins with the same counter at the same time", async () => {
    const { memberId, passkey } = await seedPasskey(0);
    const challenge = await loginChallenge();
    let pending: Promise<PasskeyRefusal | "in"> | undefined;
    // The first sign-in, holding the passkey's row: the counter is 5 now.
    await t.db.transaction(async (tx) => {
      await tx
        .update(credentials)
        .set({ counter: 5 })
        .where(eq(credentials.id, passkey.id));
      pending = outcome({
        challenge,
        credentialId: passkey.credentialId,
        counter: 5,
      });
      await waitForALockWait(t);
    });
    expect(await pending).toBe("passkey-not-usable");
    expect(await sessionsOf(memberId)).toEqual([]);
    expect((await challengeRow(challenge)).usedAt).toBeNull();
  });
});

describe("deleteStaleChallenges", () => {
  /** A challenge that expired `hours` ago, used or not. */
  async function expired(hours: number, used = false): Promise<string> {
    const challenge = await loginChallenge();
    await t.db
      .update(webauthnChallenges)
      .set({
        createdAt: sql`now() - make_interval(hours => ${hours}, mins => 5)`,
        expiresAt: sql`now() - make_interval(hours => ${hours})`,
        usedAt: used ? sql`now() - make_interval(hours => ${hours})` : null,
      })
      .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)));
    return challenge;
  }

  const exists = async (challenge: string) =>
    (
      await t.db
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.challengeHash, hashToken(challenge)))
    ).length === 1;

  it(`removes challenges expired over ${STALE_CHALLENGE_DAYS} day ago, used or not`, async () => {
    const day = STALE_CHALLENGE_DAYS * 24;
    const stale = await expired(day + 1);
    const staleUsed = await expired(day + 1, true);
    const recent = await expired(day - 1);
    const fresh = await loginChallenge();

    expect(await deleteStaleChallenges(app.db)).toBe(2);

    expect(await exists(stale)).toBe(false);
    expect(await exists(staleUsed)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(fresh)).toBe(true);
  });

  it("removes nothing when nothing is stale", async () => {
    await loginChallenge();
    expect(await deleteStaleChallenges(app.db)).toBe(0);
  });
});
