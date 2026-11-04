import { waitForShutdown } from "./lifecycle.js";

console.log("worker started");

const signal = await waitForShutdown();

console.log(`worker stopped (${signal})`);
