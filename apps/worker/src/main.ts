import { createDatabase, startJobQueue } from "@partneroj/db";

import { readConfig } from "./config.js";
import { waitForShutdown } from "./lifecycle.js";
import { webPushSender } from "./web-push-sender.js";
import { startWorker } from "./worker.js";

const config = readConfig(process.env);
const db = createDatabase(config.databaseUrl);
const boss = await startJobQueue(config.databaseUrl);
await startWorker({
  db,
  boss,
  send: webPushSender(config.vapid),
  log: (line) => console.log(line),
});

console.log("worker started");

const signal = await waitForShutdown();

// Lets the jobs in hand finish (docker stop waits 10 s before killing).
await boss.stop({ graceful: true, timeout: 8_000 });
await db.$client.end();
console.log(`worker stopped (${signal})`);
