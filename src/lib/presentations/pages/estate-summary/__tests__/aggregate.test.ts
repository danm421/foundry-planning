import { describe, it, expect } from "vitest";
import type { DeathSectionData, EstateTransferReportData, ReductionsLine } from "@/lib/estate/transfer-report";
import { fmtUsd, fmtPct, summarizeHousehold, buildDeathRows } from "../aggregate";

function reductions(parts: Partial<Record<ReductionsLine["kind"], number>>): ReductionsLine[] {
  const labels: Record<ReductionsLine["kind"], string> = {
    federal_estate_tax: "Federal Estate Tax",
    state_estate_tax: "State Estate Tax",
    admin_expenses: "Admin Expenses",
    debts_paid: "Debts Paid",
    ird_tax: "IRD Tax",
  };
  return (Object.keys(parts) as ReductionsLine["kind"][])
    .filter((k) => (parts[k] ?? 0) > 0)
    .map((k) => ({ kind: k, label: labels[k], amount: parts[k]! }));
}

function section(over: Partial<DeathSectionData>): DeathSectionData {
  return {
    decedent: "client", decedentName: "John", year: 2050,
    taxableEstate: 0, grossEstate: 0, assetEstateValue: 0, assetCount: 0,
    recipients: [], reductions: [], conflicts: [],
    grossEstateDollarsByAccount: {}, grossEstateDollarsByLiability: {},
    reconciliation: { sumLiabilityTransfers: 0, sumRecipients: 0, sumReductions: 0, unattributed: 0, reconciles: true },
    ...over,
  };
}

function report(over: Partial<EstateTransferReportData>): EstateTransferReportData {
  return {
    ordering: "primaryFirst", asOfLabel: "", firstDeath: null, secondDeath: null,
    aggregateRecipientTotals: [], isEmpty: false, ...over,
  };
}

describe("fmtUsd / fmtPct", () => {
  it("formats compactly", () => {
    expect(fmtUsd(8_400_000)).toBe("$8.4M");
    expect(fmtUsd(320_000)).toBe("$320k");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtPct(0.25)).toBe("25%");
  });
});

describe("summarizeHousehold", () => {
  it("sums taxes across death events and derives estateValue", () => {
    const r = report({
      firstDeath: section({ reductions: reductions({ admin_expenses: 30_000 }) }),
      secondDeath: section({ reductions: reductions({ federal_estate_tax: 1_650_000, state_estate_tax: 320_000, admin_expenses: 40_000, ird_tax: 90_000 }) }),
      aggregateRecipientTotals: [
        { key: "family_member|a", recipientLabel: "Emily", recipientKind: "family_member", fromFirstDeath: 0, fromSecondDeath: 3_150_000, total: 3_150_000 },
        { key: "family_member|b", recipientLabel: "Mark", recipientKind: "family_member", fromFirstDeath: 0, fromSecondDeath: 3_150_000, total: 3_150_000 },
      ],
    });
    const h = summarizeHousehold(r);
    expect(h.federal).toBe(1_650_000);
    expect(h.state).toBe(320_000);
    expect(h.probate).toBe(70_000); // 30k + 40k
    expect(h.ird).toBe(90_000);
    expect(h.netToHeirs).toBe(6_300_000);
    expect(h.taxAndCosts).toBe(1_650_000 + 320_000 + 70_000 + 90_000);
    expect(h.estateValue).toBe(6_300_000 + h.taxAndCosts + h.debts);
  });
});

describe("buildDeathRows", () => {
  it("emits one row per present death event with net after the four taxes", () => {
    const r = report({
      firstDeath: section({ decedentName: "John", year: 2048, grossEstate: 4_000_000, reductions: reductions({ admin_expenses: 30_000 }) }),
      secondDeath: section({ decedentName: "Jane", year: 2053, grossEstate: 8_400_000, reductions: reductions({ federal_estate_tax: 1_650_000, state_estate_tax: 320_000, admin_expenses: 40_000, ird_tax: 90_000 }) }),
    });
    const rows = buildDeathRows(r);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ deathOrder: 1, decedentName: "John", year: 2048, grossEstate: 4_000_000, federal: 0, probate: 30_000 });
    expect(rows[0].netAfterTax).toBe(4_000_000 - 30_000);
    expect(rows[1].netAfterTax).toBe(8_400_000 - (1_650_000 + 320_000 + 40_000 + 90_000));
  });
  it("single death event yields one row", () => {
    const r = report({ firstDeath: section({ grossEstate: 2_000_000 }), secondDeath: null });
    expect(buildDeathRows(r)).toHaveLength(1);
  });
});
