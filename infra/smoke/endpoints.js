// Push endpoints we accept. Anything else is refused, so a fake subscription
// cannot make the server POST to an address chosen by an attacker (SSRF).
import { URL } from "node:url";

const exactHosts = new Set([
  "fcm.googleapis.com", // Chrome, Brave, Edge on Android, Samsung Internet
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari
]);
const hostSuffixes = [".notify.windows.com"]; // Edge on Windows

/** True only for an https URL on a known push service, default port, no credentials. */
export function isPushEndpoint(value) {
  if (typeof value !== "string" || value.length > 1024) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username ||
    url.password
  ) {
    return false;
  }
  return (
    exactHosts.has(url.hostname) ||
    hostSuffixes.some((s) => url.hostname.endsWith(s))
  );
}
