// The worker's jobs (plan section 4): each new entry becomes one push per
// phone, and each push is sent on its own.
import {
  type Database,
  type EntryNotification,
  type PgBoss,
  type PushDelivery,
  queues,
} from "@partneroj/db";

import { deliver, type PushSender } from "./deliver.js";
import { fanOut } from "./fan-out.js";

/**
 * How often each queue is checked, in seconds. A push goes through two
 * queues, so the queue's part of the plan's 10 s is at most two polls.
 */
export const POLLING_SECONDS = 1;

export interface WorkerDeps {
  db: Database;
  /** The worker's own pg-boss: not sendOnly, it runs the jobs. */
  boss: PgBoss;
  send: PushSender;
  /**
   * One line per job, with ids and results only: what a notification
   * says (names, amounts) never goes to the logs.
   */
  log: (line: string) => void;
}

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const { db, boss, send, log } = deps;
  const options = { pollingIntervalSeconds: POLLING_SECONDS };

  await boss.work<EntryNotification>(
    queues.entryNotification,
    options,
    async (jobs) => {
      for (const job of jobs) {
        const count = await fanOut(db, boss, job.data.entryId, new Date());
        log(`${queues.entryNotification} ${job.id}: ${count} to send`);
      }
    },
  );

  // A throw (a push service's 429 or 5xx, the network) fails the try and
  // pg-boss runs the job again later, with the queue's backoff.
  await boss.work<PushDelivery>(queues.pushDelivery, options, async (jobs) => {
    for (const job of jobs) {
      const result = await deliver(db, send, job.data, new Date());
      log(`${queues.pushDelivery} ${job.id}: ${result}`);
    }
  });
}
