import { describe, expect, it } from "vitest";

import { isPushEndpoint, pushSubscription } from "./push.js";

const p256dh = "B".repeat(87);
const auth = "a".repeat(22);
const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

describe("isPushEndpoint", () => {
  it.each([
    endpoint,
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (url) => {
    expect(isPushEndpoint(url)).toBe(true);
  });

  it.each([
    ["plain http", "http://fcm.googleapis.com/fcm/send/abc"],
    ["another port", "https://fcm.googleapis.com:8443/fcm/send/abc"],
    ["credentials", "https://user:pw@fcm.googleapis.com/fcm/send/abc"],
    ["an unknown host", "https://example.com/push"],
    ["a look-alike host", "https://fcm.googleapis.com.example.com/abc"],
    ["a host ending like the suffix", "https://evilnotify.windows.com/abc"],
    ["the suffix alone", "https://notify.windows.com/abc"],
    ["the server itself", "https://localhost/abc"],
    ["not a URL", "fcm.googleapis.com"],
    ["too long", `${endpoint}/${"x".repeat(1024)}`],
  ])("refuses %s", (_case, url) => {
    expect(isPushEndpoint(url)).toBe(false);
  });
});

describe("pushSubscription", () => {
  // The shape of PushSubscription.toJSON() in the browser.
  const valid = { endpoint, expirationTime: null, keys: { p256dh, auth } };

  it("accepts what the browser hands over, without extra fields", () => {
    expect(pushSubscription.parse(valid)).toEqual({
      endpoint,
      keys: { p256dh, auth },
    });
  });

  it("refuses an endpoint off the known push services", () => {
    const sent = { ...valid, endpoint: "https://example.com/push" };
    expect(pushSubscription.safeParse(sent).success).toBe(false);
  });

  it.each([
    ["p256dh too short", { p256dh: p256dh.slice(1), auth }],
    [
      "p256dh with + (base64, not base64url)",
      { p256dh: `+${p256dh.slice(1)}`, auth },
    ],
    ["auth too long", { p256dh, auth: `${auth}a` }],
    ["auth missing", { p256dh }],
  ])("refuses keys with %s", (_case, keys) => {
    expect(pushSubscription.safeParse({ ...valid, keys }).success).toBe(false);
  });
});
