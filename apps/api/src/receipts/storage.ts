// Where receipt files live (plan section 9): local disk behind an
// interface, so an S3-compatible adapter can replace it later without
// touching the routes.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface ReceiptStorage {
  /** Stores the bytes under the key, replacing a file already there. */
  save(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
}

/** Injection token: `@Inject(RECEIPT_STORAGE) storage: ReceiptStorage`. */
export const RECEIPT_STORAGE = Symbol("RECEIPT_STORAGE");

export class DiskStorage implements ReceiptStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    // Written beside, then renamed: a rename within one disk is atomic,
    // so a reader (or the backup) never sees half a file, even if the
    // process dies while writing.
    const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  /** Keys are made by the API, but a key that leaves the root is refused. */
  private pathOf(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) {
      throw new Error(`storage key outside the root: ${key}`);
    }
    return path;
  }
}
