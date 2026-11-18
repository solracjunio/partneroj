import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pulling the image and starting Postgres takes a while the first time.
    hookTimeout: 120_000,
    // Each test file starts its own Postgres container. With one worker per
    // core (11 on a 12-core machine), Docker sometimes didn't bind a
    // container's port within the 120 s; at most 6 at once it does. The CI
    // runner has fewer cores than that, so this changes nothing there.
    maxWorkers: 6,
  },
});
