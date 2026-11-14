import { createECDH, randomBytes } from "node:crypto";

import webpush from "web-push";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestOptions, webPushSender } from "./web-push-sender.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const vapid = {
  subject: "https://partneroj.com.br",
  ...webpush.generateVAPIDKeys(),
};

/** A real browser's keys: a P-256 point and a 16-byte secret. */
function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

const target = {
  endpoint: "https://fcm.googleapis.com/fcm/send/sender-test",
  ...browserKeys(),
};

describe("requestOptions", () => {
  it("builds a signed, encrypted push with Urgency high and the TTL", () => {
    const request = webpush.generateRequestDetails(
      { endpoint: target.endpoint, keys: target },
      "olá",
      requestOptions(vapid, 3600),
    );

    expect(request.endpoint).toBe(target.endpoint);
    expect(request.headers).toMatchObject({
      TTL: 3600,
      Urgency: "high",
      "Content-Encoding": "aes128gcm",
    });
    // VAPID (RFC 8292): a JWT signed with the private key, and the public key.
    expect(request.headers["Authorization"]).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`),
    );
    // Encrypted (RFC 8291): the text is nowhere in the body.
    expect(Buffer.from(request.body).includes("olá")).toBe(false);
  });
});

describe("webPushSender", () => {
  it("sends with those options and gives the status", async () => {
    const send = vi
      .spyOn(webpush, "sendNotification")
      .mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const status = await webPushSender(vapid)(target, "olá", 60);

    expect(status).toBe(201);
    expect(send).toHaveBeenCalledWith(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      "olá",
      requestOptions(vapid, 60),
    );
  });

  it("gives the status of a push service's refusal", async () => {
    vi.spyOn(webpush, "sendNotification").mockRejectedValue(
      new webpush.WebPushError("gone", 410, {}, "", target.endpoint),
    );

    expect(await webPushSender(vapid)(target, "olá", 60)).toBe(410);
  });

  it("lets any other failure through", async () => {
    vi.spyOn(webpush, "sendNotification").mockRejectedValue(
      new Error("ETIMEDOUT"),
    );

    await expect(webPushSender(vapid)(target, "olá", 60)).rejects.toThrow(
      "ETIMEDOUT",
    );
  });
});
