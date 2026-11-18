const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an id from the path has the shape of one. Checked before the
 * query: Postgres refuses a malformed uuid with an error (a 500), while
 * an id that isn't there should be the same 404 as another partnership's.
 */
export function isUuid(id: string): boolean {
  return UUID.test(id);
}
