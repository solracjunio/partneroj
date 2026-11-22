// The worker's jobs (plan section 4): each new entry becomes one push per
// phone, and each push is sent on its own. Also, once a day, the old
// sign-in challenges go (plan section 6).
import {
  CHALLENGE_CLEANUP_CRON,
  type Database,
  deleteStaleChallenges,
  type EntryNotification,
  type PgBoss,
  type PushDelivery,
  queues,
} from "@partneroj/db";

import {
  deliver,
  type Delivery,
  type PushSender,
  RetryablePushError,
} from "./deliver.js";
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

/** "sent (201)", or the result alone when no push service answered. */
function describe(delivery: Delivery): string {
  return delivery.status === undefined
    ? delivery.result
    : `${delivery.result} (${delivery.status})`;
}

/**
 * Why a try failed, for the log: the push service's status, or the
 * error's code ("ECONNRESET"). Never the message: a network error's
 * message can hold the endpoint, a secret URL that lets anyone push to
 * that phone.
 */
export function failureOf(error: unknown): string {
  if (error instanceof RetryablePushError) {
    return `push service answered ${error.status}`;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return error instanceof Error ? error.name : "unknown error";
}

/**
 * Runs a job, logging a failed try before pg-boss retries it: without
 * this line a retry is invisible, only its final result shows.
 */
async function logged<T>(
  log: (line: string) => void,
  queue: string,
  job: { id: string; retryCount: number },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    log(
      `${queue} ${job.id}: try ${job.retryCount + 1} failed: ${failureOf(error)}`,
    );
    throw error;
  }
}

export async function startWorker(deps: WorkerDeps): Promise<void> {
  const { db, boss, send, log } = deps;
  const options = { pollingIntervalSeconds: POLLING_SECONDS };

  await boss.work<EntryNotification>(
    queues.entryNotification,
    options,
    async (jobs) => {
      for (const job of jobs) {
        const count = await logged(log, queues.entryNotification, job, () =>
          fanOut(db, boss, job.data.entryId, new Date()),
        );
        log(`${queues.entryNotification} ${job.id}: ${count} to send`);
      }
    },
  );

  // A throw (a push service's 429 or 5xx, the network) fails the try and
  // pg-boss runs the job again later, with the queue's backoff.
  await boss.work<PushDelivery>(queues.pushDelivery, options, async (jobs) => {
    for (const job of jobs) {
      const delivery = await logged(log, queues.pushDelivery, job, () =>
        deliver(db, send, job.data, new Date()),
      );
      log(`${queues.pushDelivery} ${job.id}: ${describe(delivery)}`);
    }
  });

  await boss.work(queues.challengeCleanup, options, async (jobs) => {
    for (const job of jobs) {
      const removed = await logged(log, queues.challengeCleanup, job, () =>
        deleteStaleChallenges(db),
      );
      log(`${queues.challengeCleanup} ${job.id}: ${removed} removed`);
    }
  });
  // Saved in the database: scheduling again on each start only updates it.
  // A day missed while the worker was down is not run late ("skip", the
  // default); the next day's run removes those rows as well.
  await boss.schedule(queues.challengeCleanup, CHALLENGE_CLEANUP_CRON, null, {
    tz: "UTC",
  });
}
