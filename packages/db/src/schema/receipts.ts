// Receipts of entries: the file lives in storage, the row says where.
import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns.js";
import { entries, members } from "./money.js";

/** Kinds of file a receipt can be: photos are re-encoded without EXIF. */
export const receiptContentTypes = [
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

/**
 * A photo or PDF of a receipt (plan section 9, "Arquivos"). The file
 * itself lives in storage under storageKey; the hash finds the same file
 * sent twice and proves the file was not changed afterwards.
 */
export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    entryId: uuid()
      .notNull()
      .references(() => entries.id),
    storageKey: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    /** SHA-256 of the stored file, in lowercase hex. */
    sha256: text().notNull(),
    uploadedBy: uuid()
      .notNull()
      .references(() => members.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("receipts_storage_key_unique").on(t.storageKey),
    unique("receipts_file_per_entry_unique").on(t.entryId, t.sha256),
    check(
      "receipts_content_type_allowed",
      sql`${t.contentType} in (${sql.raw(
        receiptContentTypes.map((type) => `'${type}'`).join(", "),
      )})`,
    ),
    // Photos are resized before upload; 10 MB is far above a real one.
    check("receipts_size_range", sql`${t.sizeBytes} between 1 and 10485760`),
    check("receipts_sha256_hex", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
