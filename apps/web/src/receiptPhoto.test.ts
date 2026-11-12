import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fitWithin, MAX_SIDE, receiptKind } from "./receiptPhoto";

describe("receiptKind", () => {
  it.each([
    ["image/jpeg", "photo"],
    ["image/png", "photo"],
    ["image/heic", "photo"],
    ["application/pdf", "pdf"],
    ["text/plain", "other"],
    ["", "other"],
  ])("reads %j as %s", (type, kind) => {
    expect(receiptKind(type)).toBe(kind);
  });
});

describe("fitWithin", () => {
  it("brings a phone photo down to 2000 px on its longest side", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });

  it("never enlarges a small image", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("keeps a very thin image at least 1 px wide", () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 2000, height: 1 });
  });

  it("always fits, and keeps the proportion", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 1, max: 20000 }),
        (width, height) => {
          const fitted = fitWithin(width, height);
          expect(Math.max(fitted.width, fitted.height)).toBeLessThanOrEqual(
            MAX_SIDE,
          );
          expect(fitted.width).toBeLessThanOrEqual(width);
          expect(fitted.height).toBeLessThanOrEqual(height);
          // Rounding moves each side by at most half a pixel, except
          // where the 1 px floor lifts it (found by fast-check: 1 x 4001).
          const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
          for (const [side, original] of [
            [fitted.width, width],
            [fitted.height, height],
          ] as const) {
            expect(
              Math.abs(side - Math.max(1, original * scale)),
            ).toBeLessThanOrEqual(0.5);
          }
        },
      ),
    );
  });
});
