// Secret tokens for invites and sessions (plan section 6). The database
// keeps only the SHA-256 of a token, so a copy of the database (a backup,
// a leaked dump) can't be used to enter.
import { createHash, randomBytes } from "node:crypto";

/** SHA-256 of a token, in lowercase hex: the value stored in the database. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A new random token and its hash. 32 random bytes can't be guessed, so a
 * fast hash is enough (a slow one, like for passwords, is for secrets that
 * people choose and that can be guessed).
 */
export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
