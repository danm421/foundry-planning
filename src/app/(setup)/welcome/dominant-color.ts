// src/app/(setup)/welcome/dominant-color.ts

/**
 * Pick an accent colour out of a logo's pixels, so the advisor never has to
 * think about hex codes. A colour picker is where people stall, and this step
 * is optional — anything that adds friction here costs a signup.
 *
 * Pure: takes RGBA bytes, returns a hex. The canvas read that produces those
 * bytes lives in the client component, which keeps this testable.
 *
 * Near-white and near-black are skipped: logos are drawn on white and inked in
 * black, and neither makes a usable accent.
 */
const NEAR_WHITE = 240;
const NEAR_BLACK = 24;
const MIN_ALPHA = 128;
const BUCKET = 16; // quantise to 4 bits/channel so shades of one colour group up

export function dominantColorFromPixels(
  pixels: Uint8ClampedArray,
): string | null {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;
    if (a < MIN_ALPHA) continue;
    if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) continue;
    if (r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK) continue;

    const key =
      (Math.floor(r / BUCKET) << 8) |
      (Math.floor(g / BUCKET) << 4) |
      Math.floor(b / BUCKET);
    const slot = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    slot.n += 1;
    slot.r += r;
    slot.g += g;
    slot.b += b;
    counts.set(key, slot);
  }

  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const slot of counts.values()) {
    if (!best || slot.n > best.n) best = slot;
  }
  if (!best) return null;

  const hex = (v: number) =>
    Math.round(v / best!.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`.toLowerCase();
}
