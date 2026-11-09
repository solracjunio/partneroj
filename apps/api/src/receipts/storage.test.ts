import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DiskStorage } from "./storage.js";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "receipts-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("DiskStorage", () => {
  it("saves and reads back, creating the folders", async () => {
    const storage = new DiskStorage(root);
    await storage.save("receipts/a/b.jpg", Buffer.from("photo"));
    expect((await storage.read("receipts/a/b.jpg")).toString()).toBe("photo");
  });

  it("replaces a file saved again and leaves no temporary file", async () => {
    const storage = new DiskStorage(root);
    await storage.save("receipts/c/d.jpg", Buffer.from("one"));
    await storage.save("receipts/c/d.jpg", Buffer.from("two"));
    expect((await storage.read("receipts/c/d.jpg")).toString()).toBe("two");
    expect(await readdir(join(root, "receipts/c"))).toEqual(["d.jpg"]);
  });

  it("refuses a key that leaves the root", async () => {
    const storage = new DiskStorage(root);
    await expect(
      storage.save("../outside.jpg", Buffer.from("x")),
    ).rejects.toThrow("outside the root");
    await expect(storage.read("receipts/../../etc/passwd")).rejects.toThrow(
      "outside the root",
    );
  });
});
