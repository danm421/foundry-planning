import { describe, it, expect } from "vitest";
import { deriveListFlags, REVIEW_DUE_MONTHS } from "../queries";

const NOW = new Date("2026-07-28T00:00:00Z");
const BASE = {
  clientId: "c1",
  householdName: "Cooper",
  compositeScore: 55,
  compositeLevel: "moderate" as const,
  bindingConstraint: "tolerance" as const,
  toleranceScore: 55,
  toleranceSource: "manual" as const,
  toleranceConfirmedAt: new Date("2026-05-01T00:00:00Z"),
  capacityScore: 70,
  environmentAdj: 0,
  requiredGrowthPct: 40,
  updatedAt: NOW,
};

describe("deriveListFlags", () => {
  it("is twelve months to review due", () => {
    expect(REVIEW_DUE_MONTHS).toBe(12);
  });

  it("flags a household with no tolerance as not established", () => {
    const f = deriveListFlags({ ...BASE, toleranceScore: null, compositeScore: null, compositeLevel: null }, NOW);
    expect(f.notEstablished).toBe(true);
    expect(f.reviewDue).toBe(false);
  });

  it("flags a tolerance confirmed over twelve months ago as review due", () => {
    const stale = { ...BASE, toleranceConfirmedAt: new Date("2025-07-01T00:00:00Z") };
    expect(deriveListFlags(stale, NOW).reviewDue).toBe(true);
    expect(deriveListFlags(BASE, NOW).reviewDue).toBe(false);
  });

  it("flags capacity as the binding constraint", () => {
    const f = deriveListFlags({ ...BASE, bindingConstraint: "capacity" }, NOW);
    expect(f.capacityConstrained).toBe(true);
  });

  it("flags goals over-reaching when required growth exceeds capacity", () => {
    expect(deriveListFlags({ ...BASE, requiredGrowthPct: 85, capacityScore: 70 }, NOW).goalsOverReaching).toBe(true);
    expect(deriveListFlags(BASE, NOW).goalsOverReaching).toBe(false);
  });

  it("flags a missing capacity as pending, not as a zero", () => {
    const f = deriveListFlags({ ...BASE, capacityScore: null, requiredGrowthPct: null }, NOW);
    expect(f.capacityPending).toBe(true);
    expect(f.goalsOverReaching).toBe(false);
  });
});
