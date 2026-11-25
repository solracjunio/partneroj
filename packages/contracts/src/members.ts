// A member's role (plan section 2), shared by the API and the web app.
import { z } from "zod";

/**
 * The role an admin sets alone: partner or admin, both of whom vote.
 * Reader isn't one: who votes changes only by a ballot (block 4). Strict,
 * so a field this doesn't know is refused instead of ignored.
 */
export const roleChangeBody = z.strictObject({
  role: z.enum(["admin", "partner"]),
});

export type RoleChangeBody = z.infer<typeof roleChangeBody>;
