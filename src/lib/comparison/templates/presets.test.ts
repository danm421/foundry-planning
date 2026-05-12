import { describe, expect, it } from "vitest";
import { ComparisonLayoutV5Schema } from "@/lib/comparison/layout-schema";
import { PRESETS } from "./index";

describe.each(PRESETS)("$name preset", (preset) => {
  it("has a valid v5 layout", () => {
    expect(() => ComparisonLayoutV5Schema.parse(preset.layout)).not.toThrow();
  });
  it("slotCount matches slotLabels length", () => {
    expect(preset.slotLabels).toHaveLength(preset.slotCount);
  });
  it("every widget planId is a slot token in 0..slotCount-1", () => {
    const allowed = ["A", "B", "C", "D", "E", "F", "G", "H"].slice(0, preset.slotCount);
    for (const g of preset.layout.groups) {
      for (const c of g.cells) {
        if (!c.widget) continue;
        for (const p of c.widget.planIds) {
          expect(allowed).toContain(p);
        }
      }
    }
  });
});
