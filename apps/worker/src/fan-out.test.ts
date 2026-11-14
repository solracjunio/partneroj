import { queueOptions, queues, type PushDelivery } from "@partneroj/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deliveryId, fanOut, NOTICE_HOURS } from "./fan-out.js";
import { entryMessage } from "./message.js";
import {
  seed,
  spend,
  startWorkerTest,
  subscribedPhone,
  type WorkerTest,
} from "./testing.js";

let w: WorkerTest;
beforeAll(async () => {
  w = await startWorkerTest();
});
afterAll(async () => {
  await w?.stop();
});

const HOUR = 3_600_000;

/** The delivery jobs queued for an entry, by subscription. */
async function deliveriesOf(entryId: string, subscriptionIds: string[]) {
  const jobs = await Promise.all(
    subscriptionIds.map((id) =>
      w.boss.getJobById<PushDelivery>(
        queues.pushDelivery,
        deliveryId(entryId, id),
      ),
    ),
  );
  return jobs;
}

/** How many delivery jobs exist for these subscriptions, of any entry. */
async function countDeliveries(subscriptionIds: string[]): Promise<number> {
  const { rows } = await w.t.db.$client.query<{ n: string }>(
    `SELECT count(*) AS n FROM pgboss.job
      WHERE name = $1 AND data->>'subscriptionId' = ANY($2)`,
    [queues.pushDelivery, subscriptionIds],
  );
  return Number(rows[0]!.n);
}

describe("fanOut", () => {
  it("queues one push per phone to tell, with the message and its deadline", async () => {
    const s = await seed(w);
    const maria = await subscribedPhone(w, s.maria);
    const leo = await subscribedPhone(w, s.leo);
    const entry = await spend(w, s);
    const ids = [maria.subscriptionId, leo.subscriptionId];

    const queued = await fanOut(w.app.db, w.boss, entry.id, entry.createdAt);

    expect(queued).toBe(2);
    const jobs = await deliveriesOf(entry.id, ids);
    const payload = JSON.stringify(
      entryMessage({
        entryId: entry.id,
        type: "expense",
        amount: 120000n,
        category: "Material",
        description: "cimento e areia",
        authorName: "João",
        reversalOf: null,
        reversalReason: null,
        createdAt: entry.createdAt,
        subscriptionIds: [],
      }),
    );
    const deadline = new Date(
      entry.createdAt.getTime() + NOTICE_HOURS * HOUR,
    ).toISOString();
    expect(jobs.map((j) => j?.data)).toEqual(
      ids.map((subscriptionId) => ({ subscriptionId, payload, deadline })),
    );
  });

  it("gives each push the delivery queue's retries", async () => {
    const s = await seed(w);
    const maria = await subscribedPhone(w, s.maria);
    const entry = await spend(w, s);

    await fanOut(w.app.db, w.boss, entry.id, entry.createdAt);

    const [job] = await deliveriesOf(entry.id, [maria.subscriptionId]);
    expect(job).toMatchObject({
      retryLimit: queueOptions[queues.pushDelivery].retryLimit,
      retryBackoff: true,
    });
  });

  it("run again (a retried job), queues nothing twice", async () => {
    const s = await seed(w);
    const maria = await subscribedPhone(w, s.maria);
    const leo = await subscribedPhone(w, s.leo);
    const entry = await spend(w, s);

    await fanOut(w.app.db, w.boss, entry.id, entry.createdAt);
    await fanOut(w.app.db, w.boss, entry.id, entry.createdAt);

    expect(
      await countDeliveries([maria.subscriptionId, leo.subscriptionId]),
    ).toBe(2);
  });

  it("drops an entry older than the deadline: no news a day late", async () => {
    // Jobs queued while the worker was down, or before it existed.
    const s = await seed(w);
    const maria = await subscribedPhone(w, s.maria);
    const entry = await spend(w, s);
    const late = new Date(entry.createdAt.getTime() + NOTICE_HOURS * HOUR);

    expect(await fanOut(w.app.db, w.boss, entry.id, late)).toBe(0);
    expect(await countDeliveries([maria.subscriptionId])).toBe(0);
  });

  it("queues nothing when no other member has a phone subscribed", async () => {
    const s = await seed(w);
    await subscribedPhone(w, s.joao); // The author only.
    const entry = await spend(w, s);

    expect(await fanOut(w.app.db, w.boss, entry.id, entry.createdAt)).toBe(0);
  });

  it("queues nothing for an entry that does not exist", async () => {
    expect(
      await fanOut(
        w.app.db,
        w.boss,
        "01a1c25b-7bf8-7cea-b37d-5194960ba97f",
        new Date(),
      ),
    ).toBe(0);
  });
});

describe("deliveryId", () => {
  const entry = "01a1c25b-7bf8-7cea-b37d-5194960ba97f";
  const phone = "01a1c25b-6e0e-789c-be70-3b6100b2b90e";

  it("is the same for the same entry and phone", () => {
    expect(deliveryId(entry, phone)).toBe(deliveryId(entry, phone));
  });

  it("differs for another phone or another entry", () => {
    expect(deliveryId(entry, phone)).not.toBe(deliveryId(phone, entry));
    expect(deliveryId(entry, phone)).not.toBe(deliveryId(entry, entry));
  });

  it("is a UUID, as pg-boss's id column wants", () => {
    expect(deliveryId(entry, phone)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
