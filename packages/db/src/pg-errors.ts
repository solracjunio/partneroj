/**
 * Postgres' unique_violation (SQLSTATE 23505). Drizzle wraps the driver
 * error; the code is on its cause.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { cause?: { code?: string } }).cause?.code === "23505";
}

/**
 * Postgres' foreign_key_violation (SQLSTATE 23503): a row pointing at one
 * that isn't there.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return (error as { cause?: { code?: string } }).cause?.code === "23503";
}
