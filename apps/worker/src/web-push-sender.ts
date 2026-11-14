// The PushSender on the `web-push` library (MPL-2.0, plan section 4):
// encrypts the payload for the phone (RFC 8291), signs with VAPID (RFC
// 8292) and posts it. Only the worker holds the private key.
import webpush, { type RequestOptions } from "web-push";

import type { PushSender } from "./deliver.js";

export interface Vapid {
  /** Who to contact about these pushes: the site (compose.yml). */
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Urgency high, so Android's battery saving (Doze) does not hold the
 * push back (plan section 4). The timeout is the socket's: a push
 * service that stops answering fails the try, and pg-boss retries.
 */
export function requestOptions(
  vapid: Vapid,
  ttlSeconds: number,
): RequestOptions {
  return {
    vapidDetails: vapid,
    TTL: ttlSeconds,
    urgency: "high",
    timeout: 10_000,
  };
}

export function webPushSender(vapid: Vapid): PushSender {
  return async (target, payload, ttlSeconds) => {
    try {
      const result = await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        requestOptions(vapid, ttlSeconds),
      );
      return result.statusCode;
    } catch (error) {
      // The library throws on any status that is not 2xx; the status is
      // what deliver() decides on.
      if (error instanceof webpush.WebPushError) return error.statusCode;
      throw error;
    }
  };
}
