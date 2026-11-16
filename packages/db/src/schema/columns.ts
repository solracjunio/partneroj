// Columns every table builds the same way.
import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

// uuidv7() is built into Postgres 18: time-ordered ids keep new rows at the
// end of the primary key index instead of scattered like random v4 ids.
export const id = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

export const createdAt = () =>
  timestamp({ withTimezone: true }).notNull().defaultNow();
