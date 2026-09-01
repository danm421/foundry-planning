// src/app/(setup)/welcome/__tests__/dominant-color.test.ts
import { describe, it, expect } from "vitest";
import { dominantColorFromPixels } from "../dominant-color";

/** Build RGBA pixel data from [r,g,b,a] tuples. */
function px(...tuples: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(tuples.flat());
}

describe("dominantColorFromPixels", () => {
  it("returns null when there is nothing to sample", () => {
    expect(dominantColorFromPixels(px([0, 0, 0, 0], [0, 0, 0, 0]))).toBeNull();
  });

  it("ignores the white background a logo is usually drawn on", () => {
    // Otherwise every logo would suggest #ffffff, which is useless as an accent.
    const pixels = px(
      [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
      [15, 125, 108, 255],
    );
    expect(dominantColorFromPixels(pixels)).toBe("#0f7d6c");
  });

  it("ignores near-black ink for the same reason", () => {
    const pixels = px([5, 5, 5, 255], [5, 5, 5, 255], [200, 40, 60, 255]);
    expect(dominantColorFromPixels(pixels)).toBe("#c8283c");
  });

  it("picks the most common colour, not the first one seen", () => {
    const pixels = px(
      [200, 40, 60, 255],
      [15, 125, 108, 255], [15, 125, 108, 255], [15, 125, 108, 255],
    );
    expect(dominantColorFromPixels(pixels)).toBe("#0f7d6c");
  });

  it("returns a lowercase 6-digit hex, which is what validatePrimaryColor accepts", () => {
    const out = dominantColorFromPixels(px([15, 125, 108, 255]));
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
  });
});
