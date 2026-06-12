import { describe, it, expect } from "vitest";
import type { ProjectionYear, MedicareYearDetail } from "@/engine/types";
import {
  fmtUsd,
  fmtPct,
  buildMedicareBars,
  computeComposition,
  computeKpis,
  buildTierLadder,
  findNearTermHeadroom,
  findEnrollment,
} from "../aggregate";

function det(over: Partial<MedicareYearDetail> = {}): MedicareYearDetail {
  return {
    enrolled: true,
    age: 67,
    partBPremium: 2000,
    partBStandardPremium: 2000,
    partBIrmaaSurcharge: 0,
    partDPremium: 500,
    partDIrmaaSurcharge: 0,
    medigapPremium: 1800,
    totalAnnualCost: 4300,
    sourceYearForIrmaa: 0,
    sourceMagi: 150_000,
    irmaaTier: 0,
    irmaaFilingStatus: "mfj",
    headroomToNextTier: Infinity,
    isColdStart: false,
    ...over,
  };
}

function year(y: number, client: MedicareYearDetail | null, spouse: MedicareYearDetail | null = null): ProjectionYear {
  const members = [client, spouse].filter(Boolean) as MedicareYearDetail[];
  if (members.length === 0) return { year: y } as unknown as ProjectionYear;
  const totalAnnualCost = members.reduce((s, m) => s + m.totalAnnualCost, 0);
  const totalIrmaaSurcharge = members.reduce((s, m) => s + m.partBIrmaaSurcharge + m.partDIrmaaSurcharge, 0);
  return {
    year: y,
    medicare: { client: client ?? undefined, spouse: spouse ?? undefined, totalAnnualCost, totalIrmaaSurcharge },
  } as unknown as ProjectionYear;
}

describe("medicare-summary aggregate", () => {
  it("fmtUsd / fmtPct", () => {
    expect(fmtUsd(206_000)).toBe("$206k");
    expect(fmtUsd(1_250_000)).toBe("$1.3M");
    expect(fmtUsd(450)).toBe("$450");
    expect(fmtPct(0.18)).toBe("18%");
  });

  it("buildMedicareBars splits base vs IRMAA and picks the max tier", () => {
    const years = [
      year(2030, det({ irmaaTier: 0 })),
      year(2031, det({ irmaaTier: 1, partBIrmaaSurcharge: 800, partDIrmaaSurcharge: 200, totalAnnualCost: 5300 }),
                  det({ irmaaTier: 2, partBIrmaaSurcharge: 1600, partDIrmaaSurcharge: 400, totalAnnualCost: 6300 })),
      year(2032, null), // no medicare → skipped
    ];
    const bars = buildMedicareBars(years);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ year: 2030, irmaa: 0, base: 4300, total: 4300, tier: 0 });
    // 2031 household IRMAA = 1000 + 2000 = 3000; total = 11600; base = 8600; tier = max(1,2)=2
    expect(bars[1]).toMatchObject({ year: 2031, irmaa: 3000, total: 11_600, base: 8600, tier: 2 });
  });

  it("computeComposition sums the four parts across enrolled members", () => {
    const years = [
      year(2031, det({ partBStandardPremium: 2000, partDPremium: 600, partDIrmaaSurcharge: 100, medigapPremium: 1800, partBIrmaaSurcharge: 800 })),
    ];
    const comp = computeComposition(years);
    expect(comp.partB).toBe(2000);     // standard only
    expect(comp.partD).toBe(500);      // 600 - 100
    expect(comp.medigap).toBe(1800);
    expect(comp.irmaa).toBe(900);      // 800 + 100
    expect(comp.total).toBe(5200);
  });

  it("computeKpis totals, IRMAA years/share, and peak tier+year", () => {
    const bars = buildMedicareBars([
      year(2030, det({ irmaaTier: 0 })),
      year(2031, det({ irmaaTier: 2, partBIrmaaSurcharge: 1000, totalAnnualCost: 5300 })),
      year(2032, det({ irmaaTier: 1, partBIrmaaSurcharge: 500, totalAnnualCost: 4800 })),
    ]);
    const k = computeKpis(bars);
    expect(k.lifetimeMedicareCost).toBe(4300 + 5300 + 4800);
    expect(k.lifetimeIrmaa).toBe(1500);
    expect(k.irmaaYears).toBe(2);
    expect(k.enrolledYears).toBe(3);
    expect(k.peakTier).toBe(2);
    expect(k.peakTierYear).toBe(2031);
    expect(k.irmaaShare).toBeCloseTo(1500 / (4300 + 5300 + 4800), 5);
  });

  it("buildTierLadder counts years per representative tier and labels derivable thresholds", () => {
    const years = [
      year(2030, det({ irmaaTier: 0, headroomToNextTier: 56_000, sourceMagi: 150_000 })), // tier1 entry ≈ 206k
      year(2031, det({ irmaaTier: 1, headroomToNextTier: 52_000, sourceMagi: 206_000 })), // tier2 entry ≈ 258k
      year(2032, det({ irmaaTier: 1, headroomToNextTier: Infinity })),
    ];
    const ladder = buildTierLadder(years);
    expect(ladder.map((r) => r.tier)).toEqual([0, 1]);
    expect(ladder[0]).toMatchObject({ tier: 0, years: 1, thresholdLabel: "Standard premium" });
    expect(ladder[1]).toMatchObject({ tier: 1, years: 2, thresholdLabel: "≥ $206k" });
  });

  it("excludes pre-enrollment years that still carry a medicare block (enrolled: false)", () => {
    // The engine emits a medicare block for pre-65 years too — members with
    // enrolled:false and zero premiums. Those years must NOT become bars or
    // tier-ladder rows, or the horizon starts years early and Tier 0 inflates.
    const years = [
      year(2028, det({ enrolled: false, age: 63 })),
      year(2029, det({ enrolled: false, age: 64 })),
      year(2030, det({ irmaaTier: 0, age: 65 })),
    ];
    const bars = buildMedicareBars(years);
    expect(bars.map((b) => b.year)).toEqual([2030]);
    const ladder = buildTierLadder(years);
    expect(ladder).toEqual([{ tier: 0, thresholdLabel: "Standard premium", years: 1 }]);
  });

  it("findNearTermHeadroom returns the first finite positive headroom year", () => {
    const years = [
      year(2030, det({ headroomToNextTier: Infinity })),
      year(2031, det({ irmaaTier: 1, headroomToNextTier: 12_345 })),
    ];
    expect(findNearTermHeadroom(years)).toEqual({ year: 2031, amount: 12_345, nextTier: 2 });
    expect(findNearTermHeadroom([year(2030, det({ headroomToNextTier: Infinity }))])).toBeNull();
  });

  it("findEnrollment returns the first enrolled year+age per owner", () => {
    const years = [
      year(2029, det({ enrolled: false, age: 64 })),
      year(2030, det({ enrolled: true, age: 65 })),
    ];
    expect(findEnrollment(years, "client")).toEqual({ year: 2030, age: 65 });
    expect(findEnrollment(years, "spouse")).toBeNull();
  });
});
