// What a file is, by its first bytes ("magic bytes"), never by its name
// or the Content-Type the client says (plan section 11, "Uploads"): both
// are whatever the client wants them to be.

export type FileKind = "jpeg" | "png" | "webp" | "pdf" | "heif" | "unknown";

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) =>
  bytes.length >= at + signature.length &&
  signature.every((byte, i) => bytes[at + i] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** HEIF brands: iPhone photos (heic) and some Samsung ones (mif1). */
const heifBrands = ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"];

export function detectFileKind(bytes: Uint8Array): FileKind {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, ...ascii("PNG\r\n\x1a\n")])) return "png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8))
    return "webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "pdf";
  // ISO media files: a size, "ftyp", then the brand.
  if (
    startsWith(bytes, ascii("ftyp"), 4) &&
    heifBrands.some((brand) => startsWith(bytes, ascii(brand), 8))
  )
    return "heif";
  return "unknown";
}
