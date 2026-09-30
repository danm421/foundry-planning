import { describe, it, expect } from "vitest";
import { bracketFloorColor, dataPalette } from "../chart-palette";
import { separation, SEPARATION_FLOOR } from "@/components/charts/__tests__/color-separation";

// Neighbouring floors are measured with the same worst-viewer instrument the
// solver's monthly chart uses: min(ΔE76 normal, ΔE76 under deuteranopia).

/** The federal ladder: seven rates, ranks 0–6. */
const LADDER = [0, 1, 2, 3, 4, 5, 6];

describe("bracketFloorColor", () => {
  it.each(["dark", "light"] as const)("gives the seven federal ranks seven distinct colours (%s)", (theme) => {
    const hexes = LADDER.map((rank) => bracketFloorColor(rank, theme));
    expect(new Set(hexes).size).toBe(7);
  });

  it.each(["dark", "light"] as const)("keeps the bars' blue and orange out of the floors (%s)", (theme) => {
    const palette = dataPalette(theme);
    for (const rank of LADDER) {
      expect(bracketFloorColor(rank, theme)).not.toBe(palette.blue);
      expect(bracketFloorColor(rank, theme)).not.toBe(palette.orange);
      expect(bracketFloorColor(rank, theme)).not.toBe(palette.sky);
    }
  });

  // Neighbouring ranks are neighbouring lines on the chart. Each pair has to
  // clear the floor for its worst viewer — a palette can pass plain ΔE76 and
  // still read as one colour to a red-green colour-blind advisor.
  it.each(["dark", "light"] as const)("separates every pair of neighbouring floors for every viewer (%s)", (theme) => {
    for (let rank = 1; rank < LADDER.length; rank++) {
      const a = bracketFloorColor(rank - 1, theme);
      const b = bracketFloorColor(rank, theme);
      expect(separation(a, b), `ranks ${rank - 1}/${rank}: ${a} vs ${b}`).toBeGreaterThan(SEPARATION_FLOOR);
    }
  });

  it("wraps past the seventh rank instead of throwing", () => {
    expect(bracketFloorColor(7)).toBe(bracketFloorColor(0));
  });
});
