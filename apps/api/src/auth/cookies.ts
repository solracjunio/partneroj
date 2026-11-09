// The session cookie (plan section 6).
import { SESSION_IDLE_DAYS } from "@partneroj/db";

/**
 * The __Host- prefix makes the browser refuse the cookie unless it is
 * Secure, has Path=/ and no Domain: no subdomain can set or read it.
 */
export const SESSION_COOKIE = "__Host-session";

/**
 * The Set-Cookie value for a session token. Sent again on each use, so
 * the cookie lives as long as the session does (SESSION_IDLE_DAYS idle).
 *
 * - HttpOnly: page scripts can't read it, so an XSS can't steal it.
 * - SameSite=Strict: the browser sends it only on requests from the app
 *   itself, never from another site (no CSRF). The app's own fetches are
 *   always same-site, so nothing is lost.
 */
export function sessionCookie(token: string): string {
  const maxAge = SESSION_IDLE_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

/** One cookie from a Cookie header ("a=1; b=2"), or undefined. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * Whether a string can be a token from newToken(): 32 bytes in base64url
 * are 43 characters. Anything else is refused before reaching the
 * database.
 */
export function isToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
