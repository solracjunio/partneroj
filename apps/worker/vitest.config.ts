import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pulling the image and starting Postgres takes a while the first time.
    hookTimeout: 120_000,
  },
});
