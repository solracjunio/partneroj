import { describe, expect, it } from "vitest";

import { readConfig } from "./config.js";

const env = {
  DATABASE_URL: "postgres://app@db/partneroj",
  VAPID_PUBLIC_KEY: "public",
  VAPID_PRIVATE_KEY: "private",
  VAPID_SUBJECT: "https://partneroj.com.br",
};

describe("readConfig", () => {
  it("reads the database and the VAPID keys", () => {
    expect(readConfig(env)).toEqual({
      databaseUrl: env.DATABASE_URL,
      vapid: {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
    });
  });

  it("names every variable missing or empty, and never shows a value", () => {
    const run = () =>
      readConfig({ ...env, VAPID_PRIVATE_KEY: "", DATABASE_URL: undefined });
    expect(run).toThrow(
      "missing environment variables: DATABASE_URL, VAPID_PRIVATE_KEY",
    );
  });
});
