import { describe, expect, it } from "vitest";

import { roleChangeBody } from "./members.js";

describe("roleChangeBody", () => {
  it.each(["admin", "partner"])("is %s", (role) => {
    expect(roleChangeBody.parse({ role })).toEqual({ role });
  });

  it.each([
    { what: "reader, which takes a ballot", body: { role: "reader" } },
    { what: "nothing", body: {} },
    { what: "an unknown field", body: { role: "admin", weight: 2 } },
    { what: "another case", body: { role: "Admin" } },
  ])("refuses $what", ({ body }) => {
    expect(roleChangeBody.safeParse(body).success).toBe(false);
  });
});
