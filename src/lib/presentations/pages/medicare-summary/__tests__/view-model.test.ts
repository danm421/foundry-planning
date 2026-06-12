import { describe, it, expect } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear, ClientData, MedicareYearDetail } from "@/engine/types";
import { buildMedicareSummaryData } from "../view-model";
import { MEDICARE_SUMMARY_OPTIONS_DEFAULT } from "../options-schema";

function det(over: Partial<MedicareYearDetail> = {}): MedicareYearDetail {
  return {
    enrolled: true, age: 67,
    partBPremium: 2000, partBStandardPremium: 2000, partBIrmaaSurcharge: 0,
    partDPremium: 500, partDIrmaaSurcharge: 0, medigapPremium: 1800, totalAnnualCost: 4300,
    sourceYearForIrmaa: 0, sourceMagi: 150_000, irmaaTier: 0, irmaaFilingStatus: "mfj",
    headroomToNextTier: Infinity, isColdStart: false, ...over,
  };
}
function mkYear(y: number, client: MedicareYearDetail | null, spouse: MedicareYearDetail | null = null): ProjectionYear {
  const members = [client, spouse].filter(Boolean) as MedicareYearDetail[];
  if (members.length === 0) return { year: y } as unknown as ProjectionYear;
  return {
    year: y,
    medicare: {
      client: client ?? undefined,
      spouse: spouse ?? undefined,
      totalAnnualCost: members.reduce((s, m) => s + m.totalAnnualCost, 0),
      totalIrmaaSurcharge: members.reduce((s, m) => s + m.partBIrmaaSurcharge + m.partDIrmaaSurcharge, 0),
    },
  } as unknown as ProjectionYear;
}

function ctxFor(years: ProjectionYear[], spouseName: string | null): BuildDataContext {
  const clientData = { expenses: [], medicareCoverage: [] } as unknown as ClientData;
  return { years, clientData, scenarioLabel: "Base Plan", spouseName } as unknown as BuildDataContext;
}

describe("buildMedicareSummaryData", () => {
  it("builds KPIs, bars, composition, ladder, headroom, and a narrative", () => {
    const years = [
      mkYear(2030, det({ enrolled: false, age: 64 })),                                  // not yet enrolled → no medicare
      mkYear(2031, det({ age: 65, headroomToNextTier: 50_000, sourceMagi: 156_000 })),  // tier 0
      mkYear(2032, det({ age: 66, irmaaTier: 2, partBIrmaaSurcharge: 1600, partDIrmaaSurcharge: 400, totalAnnualCost: 6300 })),
    ];
    const data = buildMedicareSummaryData(ctxFor(years, null), MEDICARE_SUMMARY_OPTIONS_DEFAULT);

    expect(data.isEmpty).toBe(false);
    expect(data.title).toBe("Medicare & IRMAA Summary");
    expect(data.subtitle).toContain("2031–2032");
    expect(data.bars).toHaveLength(2);
    expect(data.kpis.enrolledYears).toBe(2);
    expect(data.kpis.irmaaYears).toBe(1);
    expect(data.kpis.peakTier).toBe(2);
    expect(data.kpis.peakTierYear).toBe(2032);
    expect(data.composition.total).toBeGreaterThan(0);
    expect(data.headroom).toEqual({ year: 2031, amount: 50_000, nextTier: 1 });
    expect(data.enrollment.client).toEqual({ year: 2031, age: 65 });
    expect(data.enrollment.spouse).toBeNull();
    expect(data.narrative[0]).toContain("Medicare premiums");
  });

  it("returns an empty state when no member reaches Medicare in the horizon", () => {
    const years = [mkYear(2030, null), mkYear(2031, null)];
    const data = buildMedicareSummaryData(ctxFor(years, null), MEDICARE_SUMMARY_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(true);
    expect(data.bars).toHaveLength(0);
  });
});
