// The limit on the routes of getting in (plan section 6): they need no
// session, so anyone on the internet can call them, and asking for a
// sign-in challenge writes a row. Kept in the API's memory: it runs as a
// single process.
import type { ThrottlerModuleOptions } from "@nestjs/throttler";

/**
 * Requests per minute, per route, from one address. Loose on purpose:
 * mobile carriers put many phones behind one address (CGNAT), so two
 * partners may share it. A phone's IPv6 counts by its /64, the
 * library's default, as a phone changes addresses within it.
 */
export const PUBLIC_LIMIT_PER_MINUTE = 30;

export const throttleOptions: ThrottlerModuleOptions = {
  throttlers: [{ ttl: 60_000, limit: PUBLIC_LIMIT_PER_MINUTE }],
  errorMessage: "too_many_requests",
};
