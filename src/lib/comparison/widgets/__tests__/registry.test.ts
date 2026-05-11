import { describe, it, expect } from "vitest";
import { WIDGET_KINDS } from "../../layout-schema";
import { COMPARISON_WIDGETS } from "../registry";

describe("COMPARISON_WIDGETS registry", () => {
  it("has a definition for every WIDGET_KIND", () => {
    for (const kind of WIDGET_KINDS) {
      expect(COMPARISON_WIDGETS[kind]).toBeDefined();
      expect(COMPARISON_WIDGETS[kind].kind).toBe(kind);
    }
  });

  it("flags kpi-strip, monte-carlo, longevity as needing MC", () => {
    expect(COMPARISON_WIDGETS["kpi-strip"].needsMc).toBe(true);
    expect(COMPARISON_WIDGETS["monte-carlo"].needsMc).toBe(true);
    expect(COMPARISON_WIDGETS["longevity"].needsMc).toBe(true);
  });

  it("flags everything else as not needing MC", () => {
    expect(COMPARISON_WIDGETS["portfolio"].needsMc).toBe(false);
    expect(COMPARISON_WIDGETS["lifetime-tax"].needsMc).toBe(false);
    expect(COMPARISON_WIDGETS["liquidity"].needsMc).toBe(false);
    expect(COMPARISON_WIDGETS["estate-impact"].needsMc).toBe(false);
    expect(COMPARISON_WIDGETS["estate-tax"].needsMc).toBe(false);
    expect(COMPARISON_WIDGETS["text"].needsMc).toBe(false);
  });
});
