import { queues, type PgBoss, startJobQueue } from "@partneroj/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PushSender } from "./deliver.js";
import { startWorker } from "./worker.js";
import {
  seed,
  spend,
  startWorkerTest,
  subscribedPhone,
  type WorkerTest,
} from "./testing.js";

let w: WorkerTest;
let worker: PgBoss;
const send = vi.fn<PushSender>(() => Promise.resolve(201));
const log = vi.fn<(line: string) => void>();

beforeAll(async () => {
  w = await startWorkerTest();
  // The worker's own pg-boss, as in production: it runs the jobs.
  worker = await startJobQueue(w.app.connectionString);
  await startWorker({ db: w.app.db, boss: worker, send, log });
});
afterAll(async () => {
  await worker?.stop({ graceful: false });
  await w?.stop();
});

describe("the worker", () => {
  it("tells the other phones about an entry within seconds", async () => {
    const s = await seed(w);
    const maria = await subscribedPhone(w, s.maria);
    const leo = await subscribedPhone(w, s.leo);
    const started = Date.now();

    const entry = await spend(w, s);

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2), {
      timeout: 10_000,
      interval: 100,
    });
    // The plan's goal is under 10 s to the phone; the queue's part of it,
    // two polls of a second each, must stay well below.
    expect(Date.now() - started).toBeLessThan(5_000);
    const endpoints = send.mock.calls.map(([target]) => target.endpoint);
    expect(endpoints.sort()).toEqual([maria.endpoint, leo.endpoint].sort());
    const [, payload] = send.mock.calls[0]!;
    expect(JSON.parse(payload)).toMatchObject({ tag: entry.id });

    // One line per job, to docker logs: ids and results, never the
    // amount or the names.
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(`^${queues.pushDelivery} \\S+: sent \\(201\\)$`),
      ),
    );
    for (const line of lines) expect(line).not.toMatch(/1\.200|João|cimento/);
  });

  // A retry waits pg-boss's backoff (a few seconds), so these get longer.
  it("logs a failed try with the push service's status, then the retry that worked", async () => {
    const s = await seed(w);
    await subscribedPhone(w, s.maria);
    send
      .mockImplementationOnce(() => Promise.resolve(503))
      .mockImplementation(() => Promise.resolve(201));

    await spend(w, s);

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2), {
      timeout: 20_000,
      interval: 200,
    });
    await vi.waitFor(() => {
      const lines = log.mock.calls.map(([line]) => line);
      expect(lines).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^${queues.pushDelivery} \\S+: try 1 failed: push service answered 503$`,
          ),
        ),
      );
      expect(lines).toContainEqual(
        expect.stringMatching(
          new RegExp(`^${queues.pushDelivery} \\S+: sent \\(201\\)$`),
        ),
      );
    });
  }, 30_000);

  it("logs a network failure by its code, never its message", async () => {
    // A network error's message can hold the endpoint, a secret URL: who
    // knows it can push to that phone.
    const s = await seed(w);
    const maria = await subscribedPhone(w, s.maria);
    send
      .mockImplementationOnce(() =>
        Promise.reject(
          Object.assign(new Error(`connect ECONNRESET ${maria.endpoint}`), {
            code: "ECONNRESET",
          }),
        ),
      )
      .mockImplementation(() => Promise.resolve(201));

    await spend(w, s);

    await vi.waitFor(
      () => {
        const lines = log.mock.calls.map(([line]) => line);
        expect(lines).toContainEqual(
          expect.stringMatching(/: try 1 failed: ECONNRESET$/),
        );
      },
      { timeout: 20_000, interval: 200 },
    );
    for (const [line] of log.mock.calls) {
      expect(line).not.toContain(maria.endpoint);
      expect(line).not.toContain("fcm.googleapis.com");
    }
  }, 30_000);
});
