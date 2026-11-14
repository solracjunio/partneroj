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
      expect.stringMatching(new RegExp(`^${queues.pushDelivery} \\S+: sent$`)),
    );
    for (const line of lines) expect(line).not.toMatch(/1\.200|João|cimento/);
  });
});
