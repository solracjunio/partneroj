import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pulling the image and starting Postgres takes a while the first time.
    hookTimeout: 120_000,
    // The API refuses to start without it (src/auth/webauthn.ts). A test
    // site, never a real one: the fake passkey signs for this domain.
    env: { PUBLIC_URL: "https://partneroj.test" },
    // Each test file starts its own Postgres container. With one worker per
    // core (11 on a 12-core machine), Docker sometimes didn't bind a
    // container's port within the 120 s; at most 6 at once it does. The
    // limit is in the package's "test" script, not here: the root coverage
    // run reads this file as one of its projects, and Vitest refuses
    // projects with different maxWorkers in one run (it has its own).
  },
});
