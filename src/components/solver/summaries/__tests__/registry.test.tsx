// src/components/solver/summaries/__tests__/registry.test.tsx
import { describe, it, expect } from "vitest";
import { SUMMARY_TABS, SUMMARY_REGISTRY } from "../registry";

describe("summary registry", () => {
  it("exposes all seven summaries in display order", () => {
    expect(SUMMARY_TABS.map((t) => t.key)).toEqual(["retirement", "retirementComparison", "tax", "taxComparison", "medicare", "estate", "lifeInsurance"]);
  });
  it("flags lazy-fetch needs", () => {
    expect(SUMMARY_REGISTRY.estate.needs.fullProjection).toBe(true);
    expect(SUMMARY_REGISTRY.lifeInsurance.needs.liInventory).toBe(true);
    expect(SUMMARY_REGISTRY.tax.needs).toEqual({});
  });
});
