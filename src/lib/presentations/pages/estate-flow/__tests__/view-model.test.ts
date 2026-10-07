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

// A death with no tax owed — every section carries the engine's tax result.
const noTax = { federalEstateTax: 0, stateEstateTax: 0, drainAttributions: [] };

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
      estateTax: noTax,
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
      estateTax: noTax,
      reconciliation: { sumLiabilityTransfers: 0, sumReductions: 0, sumRecipients: 100 },
    },
    secondDeath: {
      decedentName: "Susan",
      year: 2045,
      recipients: [],
      reductions: [],
      conflicts: [],
      assetEstateValue: 200,
      estateTax: noTax,
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
      ordering: "primaryFirst",
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

  it("carries each death's projected tax as four figures, never the full tax result", () => {
    // This data is also handed to the Forge as JSON; the PDF's tax box lists
    // four figures, so the Form 706 detail would only be dead weight.
    const withTax = {
      ...twoDeathPrep,
      reportData: {
        ...twoDeathPrep.reportData,
        firstDeath: {
          ...twoDeathPrep.reportData.firstDeath,
          estateTax: {
            grossEstate: 100,
            federalEstateTax: 1_000,
            stateEstateTax: 200,
            stateInheritanceTax: { inactive: false, totalTax: 50 },
            drainAttributions: [
              { drainKind: "ird_tax", amount: 30 },
              { drainKind: "ird_tax", amount: 5 },
              { drainKind: "probate", amount: 99 },
            ],
          },
        },
      },
    };
    mockPrepEstate.mockReturnValue(withTax);
    const data = buildEstateFlowReportData(ctx, { ...baseOptions, ordering: "primaryFirst" });
    expect(data.firstColumn?.decedentName).toBe("Cooper");
    expect(data.firstColumn).not.toHaveProperty("estateTax");
    expect(data.firstColumn?.tax).toEqual({ federal: 1_000, state: 200, inheritance: 50, ird: 35 });
    expect(data.secondColumn?.tax).toEqual({ federal: 0, state: 0, inheritance: 0, ird: 0 });
  });
});
