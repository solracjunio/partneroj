import { describe, expect, it } from "vitest";

import { waitForShutdown } from "./lifecycle.js";

describe("waitForShutdown", () => {
  it("resolves with the signal received", async () => {
    const shutdown = waitForShutdown(["SIGTERM"]);

    process.emit("SIGTERM");

    await expect(shutdown).resolves.toBe("SIGTERM");
  });

  it("removes its listeners after shutting down", async () => {
    const before = process.listenerCount("SIGTERM");
    const shutdown = waitForShutdown(["SIGTERM"]);

    process.emit("SIGTERM");
    await shutdown;

    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});
