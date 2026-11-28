import { expect, it, vi } from "vitest";
import { runAdminCommand } from "./admin-commands.js";
import type { Database } from "./client.js";

it("requires a public URL before writing an emergency invite", async () => {
  const print = vi.fn();
  await expect(
    runAdminCommand(
      {} as Database,
      [
        "emergency-invite",
        "--partnership",
        "00000000-0000-4000-8000-000000000001",
        "--name",
        "Eva",
      ],
      { publicUrl: undefined, print, startQueue: vi.fn() },
    ),
  ).rejects.toThrow("PUBLIC_URL is not set");
  expect(print).not.toHaveBeenCalled();
});
