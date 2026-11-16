// Database schema (plan section 7). Column names are camelCase here and
// snake_case in Postgres (casing option in drizzle.config.ts and client.ts).
// One file per reason to change, under schema/; this file gathers them,
// so the rest of the package and drizzle-kit see one schema.
export * from "./schema/access.js";
export * from "./schema/activity.js";
export * from "./schema/money.js";
export * from "./schema/receipts.js";
