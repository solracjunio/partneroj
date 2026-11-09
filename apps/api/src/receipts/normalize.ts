// Turns an uploaded file into what is stored (plan section 9): photos are
// decoded and encoded again as JPEG, which drops every piece of metadata,
// GPS position included; a PDF is kept as sent.
import sharp from "sharp";

import { detectFileKind } from "./file-type.js";

/** Why a file was refused; the API turns each into a response. */
export type ReceiptRejection =
  "file-type-not-allowed" | "photo-format-not-supported" | "photo-unreadable";

export class ReceiptRejected extends Error {
  constructor(readonly reason: ReceiptRejection) {
    super(reason);
    this.name = "ReceiptRejected";
  }
}

export interface StoredFile {
  bytes: Buffer;
  contentType: "image/jpeg" | "application/pdf";
  extension: "jpg" | "pdf";
}

/** A receipt stays readable at this size, and far below the 10 MB limit. */
const MAX_SIDE = 2000;

export async function normalizeReceipt(input: Buffer): Promise<StoredFile> {
  const kind = detectFileKind(input);
  switch (kind) {
    case "pdf":
      return { bytes: input, contentType: "application/pdf", extension: "pdf" };
    case "heif":
      // sharp's prebuilt libvips reads AVIF but not HEVC, the codec of
      // HEIC photos. The app asks for another photo (plan section 5).
      throw new ReceiptRejected("photo-format-not-supported");
    case "unknown":
      throw new ReceiptRejected("file-type-not-allowed");
    default:
      try {
        const bytes = await sharp(input, { failOn: "error" })
          // Applies the EXIF orientation to the pixels, before the EXIF
          // is dropped: otherwise a phone photo could end up sideways.
          .rotate()
          .resize(MAX_SIDE, MAX_SIDE, {
            fit: "inside",
            withoutEnlargement: true,
          })
          // No withMetadata(): sharp writes no EXIF, ICC or XMP.
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();
        return { bytes, contentType: "image/jpeg", extension: "jpg" };
      } catch {
        throw new ReceiptRejected("photo-unreadable");
      }
  }
}
