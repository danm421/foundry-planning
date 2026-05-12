import { describe, expect, it } from "vitest";
import { ComparisonLayoutV5Schema } from "@/lib/comparison/layout-schema";
import { retirementReadinessTemplate } from "./retirement-readiness";

describe("retirementReadinessTemplate", () => {
  it("has a valid v5 layout", () => {
    expect(() => ComparisonLayoutV5Schema.parse(retirementReadinessTemplate.layout)).not.toThrow();
  });
  it("slotCount matches slotLabels", () => {
    expect(retirementReadinessTemplate.slotLabels).toHaveLength(retirementReadinessTemplate.slotCount);
  });
  it("widget planIds only use slot tokens in 0..slotCount-1", () => {
    const allowed = ["A", "B"];
    for (const g of retirementReadinessTemplate.layout.groups) {
      for (const c of g.cells) {
        if (!c.widget) continue;
        for (const p of c.widget.planIds) {
          expect(allowed).toContain(p);
        }
      }
    }
  });
});
