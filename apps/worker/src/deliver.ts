// One push to one phone (plan section 4), and what each answer of the
// push service means: done, forget the phone, try later, or give up.
import { isPushEndpoint } from "@partneroj/contracts";
import {
  type Database,
  type DeliveryTarget,
  deliveryTarget,
  forgetSubscription,
  type PushDelivery,
} from "@partneroj/db";

/**
 * Posts an encrypted push and gives the push service's HTTP status. A
 * failure to reach it at all (network, timeout) is thrown instead.
 */
export type PushSender = (
  target: DeliveryTarget,
  payload: string,
  ttlSeconds: number,
) => Promise<number>;

/** A push service's "not now" (429, 5xx): pg-boss retries the job. */
export class RetryablePushError extends Error {
  constructor(readonly status: number) {
    super(`push service answered ${status}`);
    this.name = "RetryablePushError";
  }
}

/**
 * - "sent": the push service took it.
 * - "gone": it answered 404 or 410; this phone's subscription is forgotten.
 * - "refused": another 4xx (a bad key, too big): retrying would fail again.
 * - "expired": past the deadline; dropped unsent.
 * - "no-target": the session was revoked or went idle, or the
 *   subscription was removed, since the notice.
 * - "unsafe": the endpoint is not a known push service; never posted to.
 */
export type DeliveryResult =
  "sent" | "gone" | "refused" | "expired" | "no-target" | "unsafe";

/**
 * The result, and the push service's HTTP status when it answered: the
 * log shows "refused (403)", which tells a VAPID key mismatch from a
 * payload too large (413).
 */
export interface Delivery {
  result: DeliveryResult;
  status?: number;
}

export async function deliver(
  db: Database,
  send: PushSender,
  job: PushDelivery,
  now: Date,
): Promise<Delivery> {
  // The push service keeps an undelivered push (phone off) only until
  // the deadline, too: the TTL is what is left of it.
  const ttl = Math.floor((Date.parse(job.deadline) - now.getTime()) / 1000);
  if (ttl <= 0) return { result: "expired" };

  const target = await deliveryTarget(db, job.subscriptionId);
  if (target === null) return { result: "no-target" };
  if (!isPushEndpoint(target.endpoint)) return { result: "unsafe" };

  const status = await send(target, job.payload, ttl);
  if (status >= 200 && status < 300) return { result: "sent", status };
  if (status === 404 || status === 410) {
    await forgetSubscription(db, {
      id: job.subscriptionId,
      endpoint: target.endpoint,
    });
    return { result: "gone", status };
  }
  if (status === 429 || status >= 500) throw new RetryablePushError(status);
  return { result: "refused", status };
}
