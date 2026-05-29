import { describe, it, expect } from "vitest";
import { holdingCreateSchema, holdingUpdateSchema, holdingOverrideSchema, classifyTickerSchema } from "../holdings";

describe("holdings schemas", () => {
  it("accepts a valid create body", () => {
    const r = holdingCreateSchema.safeParse({
      securityId: "11111111-1111-1111-1111-111111111111",
      displayTicker: "VTI", shares: 10, price: 250.5, costBasis: 2000, priceAsOf: "2026-05-28",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative shares", () => {
    expect(holdingCreateSchema.safeParse({ displayTicker: "VTI", shares: -1, price: 1, costBasis: 0 }).success).toBe(false);
  });

  it("override weights must each be 0..1 and total ≤ 1", () => {
    const ok = holdingOverrideSchema.safeParse({ overrides: [{ assetClassId: "11111111-1111-1111-1111-111111111111", weight: 0.6 }] });
    expect(ok.success).toBe(true);
    const bad = holdingOverrideSchema.safeParse({ overrides: [{ assetClassId: "11111111-1111-1111-1111-111111111111", weight: 1.5 }] });
    expect(bad.success).toBe(false);
  });

  it("classify requires a non-empty ticker", () => {
    expect(classifyTickerSchema.safeParse({ ticker: "VTI" }).success).toBe(true);
    expect(classifyTickerSchema.safeParse({ ticker: "" }).success).toBe(false);
  });

  it("update is a partial of create", () => {
    expect(holdingUpdateSchema.safeParse({ price: 99 }).success).toBe(true);
  });
});
