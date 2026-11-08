import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appLogin, prepareDatabase } from "./prepare.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await startTestDatabase();
});
afterAll(async () => {
  await t?.stop();
});

/** Opens a connection as the app login with this password, or fails. */
async function loginAsApp(password: string): Promise<string> {
  const url = new URL(t.connectionString);
  url.username = appLogin;
  url.password = password;
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    const { rows } = await client.query<{ code: string }>(
      "select has_table_privilege('audit_log', 'delete')::text as code",
    );
    return rows[0]!.code;
  } catch (error) {
    return (error as { code?: string }).code ?? "no code";
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Each deploy runs prepareDatabase() as the owner, so it must be safe to
// run on a database that is already up to date.
describe("prepareDatabase", () => {
  it("creates the app login in the restricted role", async () => {
    await prepareDatabase(t.connectionString, "first-password");
    // Logged in, and without DELETE on the audit log.
    expect(await loginAsApp("first-password")).toBe("false");
  });

  it("runs again on the next deploy and takes a new password", async () => {
    await prepareDatabase(t.connectionString, "second-password");
    expect(await loginAsApp("second-password")).toBe("false");
    // 28P01 invalid_password: the old password no longer works.
    expect(await loginAsApp("first-password")).toBe("28P01");
  });

  it("refuses an empty password", async () => {
    await expect(prepareDatabase(t.connectionString, "")).rejects.toThrow(
      /password/,
    );
  });
});
