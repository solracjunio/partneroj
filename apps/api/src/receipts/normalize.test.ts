import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeReceipt, ReceiptRejected } from "./normalize.js";

/** A phone-like photo: 4000×3000, rotated by EXIF, with a GPS position. */
async function phonePhoto(): Promise<Buffer> {
  return sharp({
    create: { width: 4000, height: 3000, channels: 3, background: "#c33" },
  })
    .jpeg()
    .withMetadata({
      orientation: 6, // "rotate 90°": the camera was held upright
      exif: {
        IFD0: { Make: "TestPhone" },
        IFD3: {
          GPSLatitudeRef: "S",
          GPSLatitude: "23/1 33/1 0/1",
          GPSLongitudeRef: "W",
          GPSLongitude: "46/1 38/1 0/1",
        },
      },
    })
    .toBuffer();
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReceiptRejected) return error.reason;
    throw error;
  }
  return "accepted";
}

describe("normalizeReceipt", () => {
  it("drops every metadata of a photo, GPS included", async () => {
    const input = await phonePhoto();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const stored = await normalizeReceipt(input);
    const meta = await sharp(stored.bytes).metadata();
    expect(stored.contentType).toBe("image/jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(stored.bytes.includes(Buffer.from("TestPhone"))).toBe(false);
  });

  it("turns the photo upright and fits it in 2000 px", async () => {
    const stored = await normalizeReceipt(await phonePhoto());
    const meta = await sharp(stored.bytes).metadata();
    // 4000×3000 rotated by 90° is 3000×4000, then fit inside 2000.
    expect([meta.width, meta.height]).toEqual([1500, 2000]);
  });

  it("stores PNG and WebP as JPEG", async () => {
    for (const format of ["png", "webp"] as const) {
      const input = await sharp({
        create: { width: 10, height: 10, channels: 3, background: "#fff" },
      })
        .toFormat(format)
        .toBuffer();
      expect((await normalizeReceipt(input)).extension).toBe("jpg");
    }
  });

  it("keeps a PDF as sent", async () => {
    const pdf = Buffer.from("%PDF-1.7\n%test\n");
    expect(await normalizeReceipt(pdf)).toEqual({
      bytes: pdf,
      contentType: "application/pdf",
      extension: "pdf",
    });
  });

  it("refuses HEIC with its own reason, for the app to ask another photo", async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypheic"),
      Buffer.alloc(32),
    ]);
    expect(await reason(normalizeReceipt(heic))).toBe(
      "photo-format-not-supported",
    );
  });

  it("refuses a file that is not a photo or a PDF", async () => {
    expect(await reason(normalizeReceipt(Buffer.from("<html>")))).toBe(
      "file-type-not-allowed",
    );
  });

  it("refuses a broken photo", async () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(await reason(normalizeReceipt(broken))).toBe("photo-unreadable");
  });
});
