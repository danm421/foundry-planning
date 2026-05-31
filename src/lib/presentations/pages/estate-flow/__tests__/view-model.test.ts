import { describe, it, expect, vi } from "vitest";

const mockPrepEstate = vi.fn();

vi.mock("@/lib/presentations/shared/estate-context", () => ({
  prepEstate: (...args: unknown[]) => mockPrepEstate(...args),
}));

import { buildEstateFlowReportData } from "../view-model";
import type { BuildDataContext } from "@/components/presentations/registry";

const ctx = {
  scenarioLabel: "Base Case",
  clientName: "Cooper Sample",
  spouseName: "Susan Sample",
} as unknown as BuildDataContext;

// Shared base options (no ordering → defaults to "primaryFirst" in the schema)
const baseOptions = {
  asOf: { kind: "split" as const },
  showHeirDetail: true,
};

// Single-death mock (original test scenario)
const singleDeathPrep = {
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
};

// Two-death mock for ordering tests
const twoDeathPrep = {
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
    secondDeath: {
      decedentName: "Susan",
      year: 2045,
      recipients: [],
      reductions: [],
      conflicts: [],
      assetEstateValue: 200,
      reconciliation: { sumLiabilityTransfers: 0, sumReductions: 0, sumRecipients: 200 },
    },
  },
  ownership: {
    groups: [{ key: "client", kind: "client", label: "Cooper", subtotal: 100, assets: [] }],
    grandTotal: 100,
  },
  summary: null,
  planStartYear: 2026,
  planEndYear: 2056,
  asOfYear: 2026,
};

describe("buildEstateFlowReportData", () => {
  it("forwards ownership + both death columns via pickDeathColumns", () => {
    mockPrepEstate.mockReturnValue(singleDeathPrep);
    const data = buildEstateFlowReportData(ctx, {
      asOf: { kind: "split" },
      showHeirDetail: true,
    });
    expect(data.title).toBe("Estate Flow");
    expect(data.subtitle).toContain("As of 2026");
    expect(data.ownership.grandTotal).toBe(100);
    expect(data.firstColumn?.decedentName).toBe("Cooper");
    expect(data.secondColumn).toBeNull();
  });

  it("F11: default ordering (primaryFirst) keeps primary as first column", () => {
    mockPrepEstate.mockReturnValue(twoDeathPrep);
    const data = buildEstateFlowReportData(ctx, { ...baseOptions, ordering: "primaryFirst" });
    expect(data.firstColumn?.decedentName).toBe("Cooper");
    expect(data.secondColumn?.decedentName).toBe("Susan");
  });

  it("F11: buildEstateFlowReportData honors spouseFirst ordering", () => {
    mockPrepEstate.mockReturnValue(twoDeathPrep);
    const data = buildEstateFlowReportData(ctx, { ...baseOptions, ordering: "spouseFirst" });
    // In split mode with spouseFirst, columns should be swapped
    expect(data.firstColumn?.decedentName).toBe("Susan");
    expect(data.secondColumn?.decedentName).toBe("Cooper");
  });
});
