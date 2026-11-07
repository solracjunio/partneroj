// Database schema (plan section 7). Column names are camelCase here and
// snake_case in Postgres (casing option in drizzle.config.ts and client.ts).
import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// uuidv7() is built into Postgres 18: time-ordered ids keep new rows at the
// end of the primary key index instead of scattered like random v4 ids.
const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();

export const partnerships = pgTable("partnerships", {
  id: id(),
  name: text().notNull(),
  /** Brazilian company id (CNPJ), when there is a company. */
  taxId: text(),
  createdAt: createdAt(),
});

export const memberRole = pgEnum("member_role", ["admin", "partner", "reader"]);

export const members = pgTable("members", {
  id: id(),
  partnershipId: uuid()
    .notNull()
    .references(() => partnerships.id),
  name: text().notNull(),
  role: memberRole().notNull(),
  pixKey: text(),
  createdAt: createdAt(),
});

export const projectKind = pgEnum("project_kind", ["construction", "ongoing"]);

export const projects = pgTable("projects", {
  id: id(),
  partnershipId: uuid()
    .notNull()
    .references(() => partnerships.id),
  name: text().notNull(),
  kind: projectKind().notNull(),
  startsOn: date({ mode: "string" }).notNull(),
  endsOn: date({ mode: "string" }),
  /** Set once, 7 days before the final settlement (plan section 3). */
  settlementAnnouncedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * A member's weight in a project (docs/adr/0002). Fixed for the whole
 * project. drawPosition is the order drawn once when the project is
 * created; the domain takes them sorted by it to break ties.
 */
export const weights = pgTable(
  "weights",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    memberId: uuid()
      .notNull()
      .references(() => members.id),
    weight: integer().notNull(),
    drawPosition: integer().notNull(),
  },
  (t) => [
    check("weights_weight_positive", sql`${t.weight} >= 1`),
    unique("weights_member_per_project_unique").on(t.projectId, t.memberId),
    unique("weights_draw_position_per_project_unique").on(
      t.projectId,
      t.drawPosition,
    ),
  ],
);
