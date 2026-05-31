import { describe, it, expect, vi } from "vitest";

// prepEstate has its own dedicated coverage in
// src/lib/presentations/shared/__tests__/estate-context.test.ts (real
// ClientData fixture + projection). Here we mock it away and only assert the
// view-model forwards the summary + framing and tolerates a null summary.
vi.mock("@/lib/presentations/shared/estate-context", () => ({
  prepEstate: () => ({
    reportData: { isEmpty: false },
    ownership: { groups: [], grandTotal: 0 },
    summary: {
      survivorNetWorth: null,
      firstDeath: null,
      secondDeath: null,
      outOfEstate: { heirs: { total: 0, entities: [] }, irrevTrusts: { total: 0, entities: [] } },
      heirBoxes: [],
      totals: { totalTaxesAndExpenses: -1000, totalToHeirs: 5000 },
    },
    planStartYear: 2026,
    planEndYear: 2056,
    asOfYear: 2026,
  }),
}));

import { buildEstateFlowChartData } from "../view-model";
import type { BuildDataContext } from "@/components/presentations/registry";

const ctx = {
  scenarioLabel: "Base Case",
  clientName: "Cooper Sample",
  spouseName: "Susan Sample",
} as unknown as BuildDataContext;

describe("buildEstateFlowChartData", () => {
  it("forwards the summary and framing", () => {
    const data = buildEstateFlowChartData(ctx, {
      asOf: { kind: "split" },
      showHeirDetail: true,
      ordering: "primaryFirst",
    });
    expect(data.title).toBe("Estate Flow");
    expect(data.subtitle).toContain("Base Case");
    expect(data.subtitle).toContain("As of 2026");
    expect(data.summary?.totals.totalToHeirs).toBe(5000);
    expect(data.showHeirDetail).toBe(true);
  });
});
