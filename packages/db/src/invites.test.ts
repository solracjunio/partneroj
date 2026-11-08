import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consumeInvite } from "./invites.js";
import { invites, members, partnerships, sessions } from "./schema.js";
import {
  pgErrorCode,
  startTestDatabase,
  type TestDatabase,
} from "./testing.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await startTestDatabase();
});
afterAll(async () => {
  await t?.stop();
});

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

/** A member and an invite for them; returns the token's hash. */
async function newInvite(
  overrides: Partial<typeof invites.$inferInsert> = {},
): Promise<{ memberId: string; tokenHash: string }> {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Test" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "A", role: "partner" })
    .returning();
  const tokenHash = hash(randomBytes(32).toString("base64url"));
  await t.db.insert(invites).values({
    memberId: member!.id,
    tokenHash,
    expiresAt: hours(24),
    createdBy: member!.id,
    ...overrides,
  });
  return { memberId: member!.id, tokenHash };
}

describe("consumeInvite", () => {
  it("returns the member of a valid invite", async () => {
    const { memberId, tokenHash } = await newInvite();
    expect(await consumeInvite(t.db, tokenHash)).toEqual({ memberId });
  });

  it("returns null for an unknown token", async () => {
    expect(await consumeInvite(t.db, hash("nope"))).toBeNull();
  });

  it("returns null the second time", async () => {
    const { tokenHash } = await newInvite();
    await consumeInvite(t.db, tokenHash);
    expect(await consumeInvite(t.db, tokenHash)).toBeNull();
  });

  it("returns null for an expired invite", async () => {
    const { tokenHash } = await newInvite({
      createdAt: hours(-48),
      expiresAt: hours(-24),
    });
    expect(await consumeInvite(t.db, tokenHash)).toBeNull();
  });

  it("returns null for a revoked invite", async () => {
    const { tokenHash } = await newInvite({ revokedAt: new Date() });
    expect(await consumeInvite(t.db, tokenHash)).toBeNull();
  });

  it("lets only one of two simultaneous taps through", async () => {
    const { memberId, tokenHash } = await newInvite();
    const results = await Promise.all([
      consumeInvite(t.db, tokenHash),
      consumeInvite(t.db, tokenHash),
    ]);
    expect(results.filter((r) => r !== null)).toEqual([{ memberId }]);
  });
});

describe("invites and sessions", () => {
  it("refuses an invite that expires before it is created", async () => {
    expect(await pgErrorCode(newInvite({ expiresAt: hours(-1) }))).toBe(
      "23514",
    );
  });

  it("refuses two sessions with the same refresh token", async () => {
    const { memberId } = await newInvite();
    const refreshTokenHash = hash(randomBytes(32).toString("base64url"));
    await t.db.insert(sessions).values({ memberId, refreshTokenHash });
    const again = t.db.insert(sessions).values({ memberId, refreshTokenHash });
    expect(await pgErrorCode(again)).toBe("23505");
  });
});
