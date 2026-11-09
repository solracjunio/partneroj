import { describe, expect, it } from "vitest";

import { detectFileKind } from "./file-type.js";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    ),
  );

describe("detectFileKind", () => {
  it.each([
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["png", bytes([0x89], "PNG\r\n\x1a\n")],
    ["webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
    ["pdf", bytes("%PDF-1.7")],
    ["heif", bytes([0, 0, 0, 0x18], "ftypheic")],
    ["heif", bytes([0, 0, 0, 0x18], "ftypmif1")],
  ])("tells %s by its first bytes", (kind, file) => {
    expect(detectFileKind(file)).toBe(kind);
  });

  it.each([
    ["an AVIF", bytes([0, 0, 0, 0x18], "ftypavif")],
    ["a script named .jpg", bytes("<script>")],
    ["an empty file", bytes()],
    ["a RIFF that is not WebP", bytes("RIFF", [0, 0, 0, 0], "WAVE")],
  ])("refuses %s", (_name, file) => {
    expect(detectFileKind(file)).toBe("unknown");
  });
});
