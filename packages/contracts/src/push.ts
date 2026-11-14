// Web Push (plan section 4): the subscription a phone hands to the API,
// shared by the API (which stores it) and the worker (which posts to it).
import { z } from "zod";

const exactHosts = new Set([
  "fcm.googleapis.com", // Chrome, Brave, Edge on Android, Samsung Internet
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari
]);
const hostSuffixes = [".notify.windows.com"]; // Edge on Windows

/**
 * True only for an https URL on a known push service, on the default port,
 * without credentials. The worker POSTs to the endpoint, so anything else
 * would let a member make the server call an address of their choosing
 * (SSRF). The API refuses at the door; the worker checks again.
 */
export function isPushEndpoint(value: string): boolean {
  if (value.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  if (url.username !== "" || url.password !== "") return false;
  return (
    exactHosts.has(url.hostname) ||
    hostSuffixes.some((suffix) => url.hostname.endsWith(suffix))
  );
}

/**
 * The phone's subscription, as PushSubscription.toJSON() gives it. The
 * keys are base64url (RFC 8291): p256dh is a P-256 point (65 bytes, 87
 * characters) and auth a 16-byte secret (22 characters). Browsers send
 * them unpadded; the padding is accepted anyway.
 */
export const pushSubscription = z.object({
  endpoint: z.string().refine(isPushEndpoint, "a known push service"),
  keys: z.object({
    p256dh: z.string().regex(/^[\w-]{87}=?$/),
    auth: z.string().regex(/^[\w-]{22}(==)?$/),
  }),
});

export type PushSubscriptionBody = z.infer<typeof pushSubscription>;

/** The key the browser subscribes with (VAPID, RFC 8292). */
export interface VapidKey {
  publicKey: string;
}
