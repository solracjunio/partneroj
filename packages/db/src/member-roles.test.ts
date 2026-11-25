import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeRole } from "./member-roles.js";
import { auditLog, members, partnerships } from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  waitForALockWait,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

let t: TestDatabase;
let app: AppConnection;
beforeAll(async () => {
  t = await startTestDatabase();
  app = await connectAsApp(t);
});
afterAll(async () => {
  await app?.db.$client.end();
  await t?.stop();
});

type Role = (typeof members.$inferSelect)["role"];

/**
 * A partnership with the given admins (João, Maria, Ana, as many as
 * asked), a partner, Bruno, and a reader, Caio.
 */
async function seed(admins: number) {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const names = ["João", "Maria", "Ana"].slice(0, admins);
  const rows = await t.db
    .insert(members)
    .values([
      ...names.map((name) => ({
        partnershipId: p!.id,
        name,
        role: "admin" as const,
      })),
      { partnershipId: p!.id, name: "Bruno", role: "partner" },
      { partnershipId: p!.id, name: "Caio", role: "reader" },
    ])
    .returning();
  const id = (name: string) => rows.find((m) => m.name === name)?.id ?? "";
  return {
    partnershipId: p!.id,
    joao: id("João"),
    maria: id("Maria"),
    ana: id("Ana"),
    bruno: id("Bruno"),
    caio: id("Caio"),
  };
}

async function roleOf(memberId: string): Promise<Role | undefined> {
  const [m] = await t.db
    .select({ role: members.role })
    .from(members)
    .where(eq(members.id, memberId));
  return m?.role;
}

async function auditOf(memberId: string) {
  return t.db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityId, memberId),
        eq(auditLog.action, "member.role_change"),
      ),
    );
}

describe("changeRole", () => {
  it("promotes a partner to admin, with one audit row", async () => {
    const s = await seed(2);

    expect(
      await changeRole(app.db, {
        actorId: s.joao,
        partnershipId: s.partnershipId,
        memberId: s.bruno,
        role: "admin",
      }),
    ).toBe("changed");
    expect(await roleOf(s.bruno)).toBe("admin");
    const audit = await auditOf(s.bruno);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: s.joao,
      before: { role: "partner" },
      after: { role: "admin" },
    });
  });

  it("demotes an admin to partner while 2 admins remain", async () => {
    const s = await seed(3);

    expect(
      await changeRole(app.db, {
        actorId: s.joao,
        partnershipId: s.partnershipId,
        memberId: s.ana,
        role: "partner",
      }),
    ).toBe("changed");
    expect(await roleOf(s.ana)).toBe("partner");
    expect((await auditOf(s.ana))[0]).toMatchObject({
      before: { role: "admin" },
      after: { role: "partner" },
    });
  });

  it("lets an admin step down while 2 admins remain", async () => {
    const s = await seed(3);

    expect(
      await changeRole(app.db, {
        actorId: s.ana,
        partnershipId: s.partnershipId,
        memberId: s.ana,
        role: "partner",
      }),
    ).toBe("changed");
    expect(await roleOf(s.ana)).toBe("partner");
  });

  it.each([
    { who: "another admin", actor: "joao", target: "maria" },
    { who: "the admin themself", actor: "maria", target: "maria" },
  ] as const)(
    "refuses to demote $who when only 2 admins are left",
    async ({ actor, target }) => {
      const s = await seed(2);

      expect(
        await changeRole(app.db, {
          actorId: s[actor],
          partnershipId: s.partnershipId,
          memberId: s[target],
          role: "partner",
        }),
      ).toBe("too-few-admins");
      expect(await roleOf(s[target])).toBe("admin");
      expect(await auditOf(s[target])).toEqual([]);
    },
  );

  it.each([
    { to: "admin", target: "caio" },
    { to: "partner", target: "caio" },
  ] as const)(
    "refuses a reader to $to: who votes changes only by a ballot",
    async ({ to, target }) => {
      const s = await seed(2);

      expect(
        await changeRole(app.db, {
          actorId: s.joao,
          partnershipId: s.partnershipId,
          memberId: s[target],
          role: to,
        }),
      ).toBe("reader");
      expect(await roleOf(s[target])).toBe("reader");
    },
  );

  it.each([
    { role: "admin", target: "maria" },
    { role: "partner", target: "bruno" },
  ] as const)(
    "changes nothing and audits nothing when $target is already $role",
    async ({ role, target }) => {
      const s = await seed(2);

      expect(
        await changeRole(app.db, {
          actorId: s.joao,
          partnershipId: s.partnershipId,
          memberId: s[target],
          role,
        }),
      ).toBe("unchanged");
      expect(await auditOf(s[target])).toEqual([]);
    },
  );

  it("refuses an actor who is not an admin", async () => {
    const s = await seed(2);

    expect(
      await changeRole(app.db, {
        actorId: s.bruno,
        partnershipId: s.partnershipId,
        memberId: s.bruno,
        role: "admin",
      }),
    ).toBe("not-admin");
    expect(await roleOf(s.bruno)).toBe("partner");
  });

  it("returns null for a member of another partnership, changing nothing", async () => {
    const mine = await seed(2);
    const theirs = await seed(3);

    expect(
      await changeRole(app.db, {
        actorId: mine.joao,
        partnershipId: mine.partnershipId,
        memberId: theirs.ana,
        role: "partner",
      }),
    ).toBeNull();
    expect(await roleOf(theirs.ana)).toBe("admin");
  });

  // The races: the test's own transaction does what another admin's
  // changeRole does, in the same order (lock the admins, then change),
  // and commits only once changeRole waits on its lock.

  /** Holds the admins as changeRole does, then sets a member's role. */
  async function anotherChange(
    partnershipId: string,
    memberId: string,
    role: Role,
    /** Starts the change that must wait; it isn't awaited here. */
    meanwhile: () => void,
  ) {
    await t.db.transaction(async (tx) => {
      await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.partnershipId, partnershipId),
            eq(members.role, "admin"),
          ),
        )
        .orderBy(asc(members.id))
        .for("update");
      await tx.update(members).set({ role }).where(eq(members.id, memberId));
      meanwhile();
      await waitForALockWait(t);
    });
  }

  it("counts again after the lock: two demotions can't leave 1 admin", async () => {
    const s = await seed(3);
    let pending: ReturnType<typeof changeRole> | undefined;
    // João demotes Maria while, at the same time, he demotes Ana.
    await anotherChange(s.partnershipId, s.maria, "partner", () => {
      pending = changeRole(app.db, {
        actorId: s.joao,
        partnershipId: s.partnershipId,
        memberId: s.ana,
        role: "partner",
      });
    });

    expect(await pending).toBe("too-few-admins");
    expect(await roleOf(s.ana)).toBe("admin");
  });

  it("checks the actor again after the lock: a demoted admin changes nothing", async () => {
    const s = await seed(3);
    let pending: ReturnType<typeof changeRole> | undefined;
    // Maria demotes João while he demotes her.
    await anotherChange(s.partnershipId, s.joao, "partner", () => {
      pending = changeRole(app.db, {
        actorId: s.joao,
        partnershipId: s.partnershipId,
        memberId: s.maria,
        role: "partner",
      });
    });

    expect(await pending).toBe("not-admin");
    expect(await roleOf(s.maria)).toBe("admin");
  });

  it("counts an admin promoted during the wait, though the lock missed them", async () => {
    const s = await seed(2);
    let pending: ReturnType<typeof changeRole> | undefined;
    // João promotes Bruno while Maria steps down: with Bruno, 2 remain.
    await anotherChange(s.partnershipId, s.bruno, "admin", () => {
      pending = changeRole(app.db, {
        actorId: s.maria,
        partnershipId: s.partnershipId,
        memberId: s.maria,
        role: "partner",
      });
    });

    expect(await pending).toBe("changed");
    expect(await roleOf(s.maria)).toBe("partner");
  });

  it("two admins demoting each other at once: one wins, no deadlock", async () => {
    const s = await seed(3);

    const results = await Promise.all([
      changeRole(app.db, {
        actorId: s.joao,
        partnershipId: s.partnershipId,
        memberId: s.maria,
        role: "partner",
      }),
      changeRole(app.db, {
        actorId: s.maria,
        partnershipId: s.partnershipId,
        memberId: s.joao,
        role: "partner",
      }),
    ]);

    expect([...results].sort()).toEqual(["changed", "not-admin"]);
    const roles = [await roleOf(s.joao), await roleOf(s.maria)].sort();
    expect(roles).toEqual(["admin", "partner"]);
  });
});
