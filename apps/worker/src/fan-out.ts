// From one entry to one push per phone (plan section 4). The entry's job
// was queued in the entry's own transaction; this turns it into the
// deliveries, each retried on its own.
import { createHash } from "node:crypto";

import type { PushMessage } from "@partneroj/contracts";
import {
  type Database,
  emergencyNotice,
  entryNotice,
  type PgBoss,
  type PushDelivery,
  queues,
} from "@partneroj/db";

import { emergencyMessage, entryMessage } from "./message.js";

/**
 * How long a notice is worth sending (the plan's TTL). Past it, the news
 * is a day old: the feed has it, and a phone buzzing now would mislead.
 * It also drops what piled up while the worker was down.
 */
export const NOTICE_HOURS = 24;

/**
 * The delivery job's id, from the notice and the phone: the same pair
 * always gives the same id, and pg-boss skips an id it already has. So a
 * fan-out run again (its job retried after a crash halfway) queues no
 * push twice. A UUID in the layout of version 8 (RFC 9562, custom), from
 * SHA-256.
 */
export function deliveryId(noticeId: string, subscriptionId: string): string {
  const hash = createHash("sha256")
    .update(`${noticeId}:${subscriptionId}`)
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x80; // version 8
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variant 10
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Queues the pushes about an entry; returns how many. */
export async function fanOut(
  db: Database,
  boss: PgBoss,
  entryId: string,
  now: Date,
): Promise<number> {
  const notice = await entryNotice(db, entryId);
  if (notice === null) return 0;
  return queueDeliveries(boss, entryId, notice, now, () =>
    entryMessage(notice),
  );
}

export async function fanOutEmergency(
  db: Database,
  boss: PgBoss,
  activityId: string,
  now: Date,
): Promise<number> {
  const notice = await emergencyNotice(db, activityId);
  if (notice === null) return 0;
  return queueDeliveries(boss, activityId, notice, now, () =>
    emergencyMessage(activityId),
  );
}

async function queueDeliveries(
  boss: PgBoss,
  noticeId: string,
  notice: { createdAt: Date; subscriptionIds: string[] },
  now: Date,
  message: () => PushMessage,
): Promise<number> {
  const deadline = new Date(
    notice.createdAt.getTime() + NOTICE_HOURS * 3_600_000,
  );
  if (now >= deadline || notice.subscriptionIds.length === 0) return 0;

  const payload = JSON.stringify(message());
  const jobs = notice.subscriptionIds.map((subscriptionId) => {
    const data: PushDelivery = {
      subscriptionId,
      payload,
      deadline: deadline.toISOString(),
    };
    return { id: deliveryId(noticeId, subscriptionId), data };
  });
  // One statement for all: either every phone's push is queued or none.
  await boss.insert(queues.pushDelivery, jobs);
  return jobs.length;
}
