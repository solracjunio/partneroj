import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activities, activityReads, members, partnerships } from "./schema.js";
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

/** A partnership with one member, who has just joined. */
async function seed() {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Test" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "A", role: "partner" })
    .returning();
  const [joined] = await t.db
    .insert(activities)
    .values({
      partnershipId: p!.id,
      actorId: member!.id,
      action: "member_joined",
    })
    .returning();
  return { partnershipId: p!.id, memberId: member!.id, activity: joined! };
}

describe("activities", () => {
  it("refuses an entry activity without its entry", async () => {
    const { partnershipId, memberId } = await seed();
    const insert = t.db.insert(activities).values({
      partnershipId,
      actorId: memberId,
      action: "entry_recorded",
    });
    expect(await pgErrorCode(insert)).toBe("23514");
  });
});

describe("activity reads", () => {
  it("records that a member read an activity", async () => {
    const { memberId, activity } = await seed();
    const read = t.db
      .insert(activityReads)
      .values({ activityId: activity.id, memberId });
    expect(await pgErrorCode(read)).toBe("no error");
  });

  it("refuses the same read twice", async () => {
    const { memberId, activity } = await seed();
    const read = { activityId: activity.id, memberId };
    await t.db.insert(activityReads).values(read);
    expect(await pgErrorCode(t.db.insert(activityReads).values(read))).toBe(
      "23505",
    );
  });
});
