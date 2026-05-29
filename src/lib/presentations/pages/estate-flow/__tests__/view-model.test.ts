import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/presentations/shared/estate-context", () => ({
  prepEstate: () => ({
    reportData: {
      isEmpty: false,
      firstDeath: {
        decedentName: "Cooper",
        year: 2040,
        recipients: [],
        reductions: [],
        conflicts: [],
        assetEstateValue: 100,
        reconciliation: { sumLiabilityTransfers: 0, sumReductions: 0, sumRecipients: 100 },
      },
      secondDeath: null,
    },
    ownership: {
      groups: [{ key: "client", kind: "client", label: "Cooper", subtotal: 100, assets: [] }],
      grandTotal: 100,
    },
    summary: null,
    planStartYear: 2026,
    planEndYear: 2056,
    asOfYear: 2026,
  }),
}));

import { buildEstateFlowReportData } from "../view-model";
import type { BuildDataContext } from "@/components/presentations/registry";

const ctx = {
  scenarioLabel: "Base Case",
  clientName: "Cooper Sample",
  spouseName: "Susan Sample",
} as unknown as BuildDataContext;

describe("buildEstateFlowReportData", () => {
  it("forwards ownership + both death columns via pickDeathColumns", () => {
    const data = buildEstateFlowReportData(ctx, {
      asOf: { kind: "split" },
      showHeirDetail: true,
    });
    expect(data.title).toBe("Estate Flow");
    expect(data.ownership.grandTotal).toBe(100);
    expect(data.firstColumn?.decedentName).toBe("Cooper");
    expect(data.secondColumn).toBeNull();
  });
});
