// Passkeys (plan section 6, "Passkey"): the challenges of WebAuthn and the
// credentials it leaves. Checking a signature is the API's job, with
// SimpleWebAuthn; this file keeps a challenge to one use, within minutes,
// by the session that asked for it.
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { isUniqueViolation } from "./pg-errors.js";
import {
  auditLog,
  credentials,
  sessions,
  webauthnChallenges,
} from "./schema.js";
import { hashToken, newToken } from "./tokens.js";

/** Long enough to find the fingerprint reader, short enough to be stale soon. */
export const CHALLENGE_LIFETIME_MINUTES = 5;

/** Why a passkey was not saved; the API turns each into a response. */
export type PasskeyRefusal = "challenge-not-usable" | "credential-taken";

export class PasskeyRefused extends Error {
  constructor(readonly reason: PasskeyRefusal) {
    super(reason);
    this.name = "PasskeyRefused";
  }
}

/** What a challenge is for: registering needs the session that asks. */
export type ChallengeFor =
  { purpose: "register"; sessionId: string } | { purpose: "login" };

/**
 * A new WebAuthn challenge: 32 random bytes, base64url, as invite tokens.
 * Only its hash is stored; the phone signs the challenge itself, which
 * comes back in the answer.
 */
export async function createChallenge(
  db: Database,
  input: ChallengeFor,
): Promise<string> {
  const { token, tokenHash } = newToken();
  await db.insert(webauthnChallenges).values({
    challengeHash: tokenHash,
    purpose: input.purpose,
    sessionId: input.purpose === "register" ? input.sessionId : null,
    expiresAt: sql`now() + make_interval(mins => ${CHALLENGE_LIFETIME_MINUTES})`,
  });
  return token;
}

/** A passkey as SimpleWebAuthn verified it, in base64url. */
export interface NewCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

/**
 * Saves the passkey of the session's member, using the challenge that the
 * API found signed in the answer. Throws PasskeyRefused when the challenge
 * can't be used (unknown, used, expired, for signing in, or another
 * session's) or the phone's credential id is already saved. Using the
 * challenge and saving the passkey commit together: when the save fails,
 * the challenge is not used up.
 */
export async function registerPasskey(
  db: Database,
  input: { sessionId: string; challenge: string; credential: NewCredential },
): Promise<{ id: string }> {
  try {
    return await db.transaction(async (tx) => {
      // One UPDATE checks and uses the challenge: a second answer with the
      // same challenge waits for this row's lock, then finds it used. Only
      // a challenge to register has a session (check
      // webauthn_challenges_session_by_purpose), so the session is enough.
      const [used] = await tx
        .update(webauthnChallenges)
        .set({ usedAt: sql`now()` })
        .from(sessions)
        .where(
          and(
            eq(webauthnChallenges.challengeHash, hashToken(input.challenge)),
            eq(webauthnChallenges.sessionId, input.sessionId),
            isNull(webauthnChallenges.usedAt),
            // Strict, as for invites; >= would differ only in the very
            // microsecond the challenge expires, which no test can hit.
            gt(webauthnChallenges.expiresAt, sql`now()`),
            eq(sessions.id, webauthnChallenges.sessionId),
          ),
        )
        .returning({ memberId: sessions.memberId });
      if (used === undefined) {
        throw new PasskeyRefused("challenge-not-usable");
      }

      const [row] = await tx
        .insert(credentials)
        .values({ memberId: used.memberId, ...input.credential })
        .returning({ id: credentials.id });

      // The public key stays out: it is in the row, and says nothing to
      // whoever reads the audit.
      await tx.insert(auditLog).values({
        actorId: used.memberId,
        action: "credential.register",
        entityId: row!.id,
        after: {
          sessionId: input.sessionId,
          credentialId: input.credential.credentialId,
        },
      });
      return row!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PasskeyRefused("credential-taken");
    throw error;
  }
}

/**
 * The member's passkeys that still let them in, oldest first: for
 * excludeCredentials, so a phone doesn't register a second one, and for
 * "Proteja sua conta", shown only while there is none.
 */
export async function activeCredentials(
  db: Database,
  memberId: string,
): Promise<{ credentialId: string; transports: string[] }[]> {
  return db
    .select({
      credentialId: credentials.credentialId,
      transports: credentials.transports,
    })
    .from(credentials)
    .where(
      and(eq(credentials.memberId, memberId), isNull(credentials.revokedAt)),
    )
    .orderBy(asc(credentials.createdAt), asc(credentials.id));
}
