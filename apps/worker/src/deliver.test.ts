import { deliveryTarget, pushSubscriptions, sessions } from "@partneroj/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deliver, type PushSender, RetryablePushError } from "./deliver.js";
import {
  seed,
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

const now = new Date("2027-01-12T12:00:00Z");
const payload = JSON.stringify({ title: "t", body: "b", tag: "x", url: "/" });

/** A push service that answers with this status. */
function service(status: number) {
  return vi.fn<PushSender>(() => Promise.resolve(status));
}

/** Maria's phone and a push for it, due in an hour. */
async function phoneAndJob() {
  const s = await seed(w);
  const phone = await subscribedPhone(w, s.maria);
  const job = {
    subscriptionId: phone.subscriptionId,
    payload,
    deadline: new Date(now.getTime() + 3_600_000).toISOString(),
  };
  return { phone, job };
}

const stillThere = (subscriptionId: string) =>
  deliveryTarget(w.app.db, subscriptionId);

describe("deliver", () => {
  it("sends the payload to the phone, to live only until the deadline", async () => {
    const { phone, job } = await phoneAndJob();
    const send = service(201);

    expect(await deliver(w.app.db, send, job, now)).toEqual({
      result: "sent",
      status: 201,
    });

    expect(send).toHaveBeenCalledWith(
      {
        endpoint: phone.endpoint,
        p256dh: "B".repeat(87),
        auth: "a".repeat(22),
      },
      payload,
      3600,
    );
  });

  it.each([404, 410])(
    "forgets the subscription the push service answers %i for",
    async (status) => {
      const { phone, job } = await phoneAndJob();

      expect(await deliver(w.app.db, service(status), job, now)).toEqual({
        result: "gone",
        status,
      });

      expect(await stillThere(phone.subscriptionId)).toBeNull();
    },
  );

  it.each([429, 500, 503])(
    "throws on %i, so pg-boss tries again later",
    async (status) => {
      const { phone, job } = await phoneAndJob();

      await expect(
        deliver(w.app.db, service(status), job, now),
      ).rejects.toThrow(RetryablePushError);

      expect(await stillThere(phone.subscriptionId)).not.toBeNull();
    },
  );

  it.each([400, 403, 413])(
    "gives up on %i: sending it again would fail again",
    async (status) => {
      const { phone, job } = await phoneAndJob();

      expect(await deliver(w.app.db, service(status), job, now)).toEqual({
        result: "refused",
        status,
      });

      expect(await stillThere(phone.subscriptionId)).not.toBeNull();
    },
  );

  it("drops a push past its deadline without sending", async () => {
    const { job } = await phoneAndJob();
    const send = service(201);

    expect(
      await deliver(
        w.app.db,
        send,
        { ...job, deadline: now.toISOString() },
        now,
      ),
    ).toEqual({ result: "expired" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing to a phone whose session was revoked since", async () => {
    const { phone, job } = await phoneAndJob();
    await w.t.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, phone.sessionId));
    const send = service(201);

    expect(await deliver(w.app.db, send, job, now)).toEqual({
      result: "no-target",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("never posts to an address off the known push services", async () => {
    // Second check: the API refuses these, but the row could come from
    // elsewhere (a script, an old version).
    const { phone, job } = await phoneAndJob();
    await w.t.db
      .update(pushSubscriptions)
      .set({ endpoint: "https://example.com/push" })
      .where(eq(pushSubscriptions.id, phone.subscriptionId));
    const send = service(201);

    expect(await deliver(w.app.db, send, job, now)).toEqual({
      result: "unsafe",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("lets a network failure through, so pg-boss tries again", async () => {
    const { job } = await phoneAndJob();
    const send = vi.fn<PushSender>(() =>
      Promise.reject(new Error("ECONNRESET")),
    );

    await expect(deliver(w.app.db, send, job, now)).rejects.toThrow(
      "ECONNRESET",
    );
  });
});
