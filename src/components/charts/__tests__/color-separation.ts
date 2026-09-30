// The colour-separation instrument shared by the chart palette tests: CIE Lab
// ΔE76 and a deuteranopia simulation, combined into one worst-viewer distance.
// Lifted from solver-monthly-cash-flow-chart.test.ts so a second palette test
// measures with the same instrument instead of a drifting copy.

/**
 * CIE Lab, so band colours can be compared the way an eye compares them rather
 * than by hex equality. Two bands can be "different colours" by `!==` and still
 * be the same colour on screen — which is exactly the defect the pinned-hue
 * assertions above cannot see, and exactly what shipped: Living #6a3fa0 sat
 * 30.7 ΔE76 from Savings #2c5fa8 and advisors read them as one blue.
 */
function toLab(hex: string): [number, number, number] {
  const srgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ];
  const [fx, fy, fz] = xyz.map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Deuteranopia, simulated in LMS (Vienot/Brettel): the green cone response is
 * rebuilt from the red and blue ones, which is what a red-green colour-blind
 * reader's eye does. ~5% of men read these charts that way, and every palette
 * this chart has had to withdraw looked fine until it was measured here.
 */
function deuteranope(hex: string): string {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const un = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = 17.8824 * r + 43.5161 * g + 4.11935 * b;
  const s = 0.0299566 * r + 0.184309 * g + 1.46709 * b;
  const m = 0.494207 * l + 1.24827 * s; // the missing cone, reconstructed
  const out = [
    0.0809444479 * l - 0.130504409 * m + 0.116721066 * s,
    -0.0102485335 * l + 0.0540193266 * m - 0.113614708 * s,
    -0.000365296938 * l - 0.00412161469 * m + 0.693511405 * s,
  ];
  return `#${out
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, un(v))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * How far apart two bands are IN THE WORST CASE — normal vision or
 * deuteranopia, whichever reads them as closer. A pair is only as separated as
 * its worst viewer, and taking the minimum is what makes one number cover both:
 * plain ΔE76 passed purple/blue at 30.7 while a colour-blind advisor saw 2.6.
 */
export function separation(a: string, b: string): number {
  return Math.min(deltaE76(a, b), deltaE76(deuteranope(a), deuteranope(b)));
}

/**
 * The separation a pair of bands has to clear. Named once and shared by the
 * guard and by the tests that claim what the guard detects — a floor restated
 * in three places can be lowered in one of them and still look proven.
 */
export const SEPARATION_FLOOR = 20;
