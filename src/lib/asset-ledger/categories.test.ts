// src/lib/asset-ledger/categories.test.ts
import { describe, it, expect } from "vitest";
import { FLOW_CATEGORY_LABEL } from "./categories";

describe("FLOW_CATEGORY_LABEL", () => {
  it("labels the categories the table renders", () => {
    expect(FLOW_CATEGORY_LABEL.growth).toBe("Growth");
    expect(FLOW_CATEGORY_LABEL.rmd).toBe("RMD");
    expect(FLOW_CATEGORY_LABEL.savings_contribution).toBe("Contribution");
    expect(FLOW_CATEGORY_LABEL.entity_distribution).toBe("Entity Distribution");
  });

  it("has no empty labels", () => {
    for (const [key, label] of Object.entries(FLOW_CATEGORY_LABEL)) {
      expect(label, key).not.toBe("");
    }
  });
});
