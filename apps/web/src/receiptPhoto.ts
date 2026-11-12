// The receipt, made ready on the phone before it is sent (plan section 5).
// A photo is drawn again on a canvas, at most 2000 px on its longest side,
// and encoded as JPEG: the canvas keeps only the pixels, so the GPS
// position and the rest of the EXIF never leave the phone, and a 5 MB
// photo goes up as a few hundred KB. The API does the same again with
// sharp (normalize.ts), which is the real guarantee; this is the one that
// keeps the position off the network. A PDF is sent as chosen.

/** Same side as MAX_SIDE in the API's normalize.ts. */
export const MAX_SIDE = 2000;

/** Same limit as the API's MAX_UPLOAD_BYTES and Caddy's request_body. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const JPEG_QUALITY = 0.85;

export type ReceiptKind = "photo" | "pdf" | "other";

export function receiptKind(type: string): ReceiptKind {
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "photo";
  return "other";
}

/**
 * The size to draw at: the longest side at most `max`, the proportion
 * kept, never enlarged, and never below 1 px.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_SIDE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface ReadyReceipt {
  blob: Blob;
  kind: "photo" | "pdf";
  name: string;
}

/** Why a chosen file can't be sent: not a photo or PDF, unreadable, too big. */
export type ReceiptProblem = "kind" | "unreadable" | "too-big";

export type PreparedReceipt =
  { ok: true; receipt: ReadyReceipt } | { ok: false; problem: ReceiptProblem };

/** Turns the chosen file into what is sent. Runs only in the browser. */
export async function prepareReceipt(file: File): Promise<PreparedReceipt> {
  const kind = receiptKind(file.type);
  if (kind === "other") return { ok: false, problem: "kind" };
  if (kind === "pdf") {
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, problem: "too-big" };
    return { ok: true, receipt: { blob: file, kind, name: file.name } };
  }

  let bitmap: ImageBitmap;
  try {
    // "from-image" turns the photo upright by its EXIF orientation now,
    // since the orientation goes away with the rest of the EXIF.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Mostly HEIC, which most browsers can't open.
    return { ok: false, problem: "unreadable" };
  }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    return { ok: false, problem: "unreadable" };
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (blob === null) return { ok: false, problem: "unreadable" };
  return { ok: true, receipt: { blob, kind, name: file.name } };
}
