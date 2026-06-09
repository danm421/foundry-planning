import { describe, it, expect } from "vitest";
import { applyGiftsToClientData, type EstateFlowGift } from "@/lib/estate/estate-flow-gifts";
import type { ClientData } from "@/engine/types";

// Minimal ClientData stub — only the fields applyGiftsToClientData reads.
function makeData(): ClientData {
  return {
    gifts: [],
    giftEvents: [],
    liabilities: [],
    taxYearRows: [{ year: 2026, giftAnnualExclusion: 19_000 }],
    planSettings: {
      planStartYear: 2026,
      planEndYear: 2028,
      inflationRate: 0,
      taxInflationRate: 0,
    },
  } as unknown as ClientData;
}

describe("applyGiftsToClientData — annual-exclusion series", () => {
  it("fans out per-year exclusion amounts (×2 for joint) instead of a flat annualAmount", () => {
    const series: EstateFlowGift = {
      kind: "series",
      id: "se1",
      startYear: 2026,
      endYear: 2027,
      annualAmount: 38_000, // ignored in annual_exclusion mode
      amountMode: "annual_exclusion",
      inflationAdjust: false,
      grantor: "joint",
      recipient: { kind: "entity", id: "t1" },
      crummey: true,
    };
    const out = applyGiftsToClientData(makeData(), [series], 0);
    const amounts = out.giftEvents.filter((e) => e.kind === "cash").map((e) => e.amount);
    // 19,000 × 2 grantors, each plan year 2026 + 2027.
    expect(amounts).toEqual([38_000, 38_000]);
  });

  it("still uses the flat annualAmount when amountMode is fixed", () => {
    const series: EstateFlowGift = {
      kind: "series",
      id: "se2",
      startYear: 2026,
      endYear: 2026,
      annualAmount: 5_000,
      amountMode: "fixed",
      inflationAdjust: false,
      grantor: "client",
      recipient: { kind: "entity", id: "t1" },
      crummey: false,
    };
    const out = applyGiftsToClientData(makeData(), [series], 0);
    const amounts = out.giftEvents.filter((e) => e.kind === "cash").map((e) => e.amount);
    expect(amounts).toEqual([5_000]);
  });
});
