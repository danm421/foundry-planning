// src/lib/tax-ledger/build-diagnostics.test.ts
import { describe, expect, it } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import { buildDiagnostics } from "./build-diagnostics";

function fixtureYear(): ProjectionYear {
  return {
    year: 2030,
    income: { socialSecurity: 30000 } as ProjectionYear["income"],
    medicare: {
      client: { irmaaTier: 2, headroomToNextTier: 12000 },
      totalAnnualCost: 0, totalIrmaaSurcharge: 0,
    } as unknown as ProjectionYear["medicare"],
    taxResult: {
      income: { taxableSocialSecurity: 25500 },
      flow: {
        adjustedGrossIncome: 240000, taxableIncome: 210000, incomeTaxBase: 165000,
        regularFederalIncomeTax: 30000, capitalGainsTax: 9750, niit: 1900,
        additionalMedicare: 0, fica: 0, stateTax: 11400, totalFederalTax: 41650,
        totalTax: 53050, earlyWithdrawalPenalty: 0, amtAdditional: 0,
      },
      diag: {
        marginalFederalRate: 0.24, effectiveFederalRate: 0.17,
        marginalBracketTier: { from: 100000, to: 190000, rate: 0.24 },
        bracketsUsed: { niitRate: 0.038, niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 } },
      },
    } as unknown as ProjectionYear["taxResult"],
  } as unknown as ProjectionYear;
}

describe("buildDiagnostics", () => {
  it("computes headroom to the next bracket", () => {
    const d = buildDiagnostics(fixtureYear(), "married_joint");
    expect(d.bracketHeadroom).toBe(25000); // 190000 − 165000
  });
  it("reports NIIT base and threshold distance (under threshold)", () => {
    const d = buildDiagnostics(fixtureYear(), "married_joint");
    expect(d.niit.active).toBe(true);
    expect(d.niit.base).toBeCloseTo(50000, 0); // 1900 / 0.038
    expect(d.niit.thresholdDistance).toBe(10000); // 250000 − 240000
  });
  it("surfaces the IRMAA tier from the higher-tier spouse", () => {
    const d = buildDiagnostics(fixtureYear(), "married_joint");
    expect(d.irmaa.tier).toBe(2);
    expect(d.irmaa.headroomToNextTier).toBe(12000);
  });
  it("computes SS taxable percent", () => {
    const d = buildDiagnostics(fixtureYear(), "married_joint");
    expect(d.ssTaxablePercent).toBeCloseTo(0.85, 2);
  });
  it("maps tax-by-type from flow", () => {
    const d = buildDiagnostics(fixtureYear(), "married_joint");
    expect(d.taxByType.federalOrdinary).toBe(30000);
    expect(d.taxByType.capitalGains).toBe(9750);
    expect(d.taxByType.state).toBe(11400);
  });
});

describe("buildDiagnostics — the AMT badge (F37)", () => {
  it("does not call a sub-dollar excess an AMT year", () => {
    const y = fixtureYear();
    y.taxResult!.flow.amtAdditional = 0.4;
    expect(buildDiagnostics(y, "married_joint").amt.bound).toBe(false);
  });
  it("still reports the cents so the ledger reconciles", () => {
    const y = fixtureYear();
    y.taxResult!.flow.amtAdditional = 0.4;
    expect(buildDiagnostics(y, "married_joint").amt.additional).toBe(0.4);
  });
  it("binds from a whole dollar up", () => {
    const y = fixtureYear();
    y.taxResult!.flow.amtAdditional = 1;
    expect(buildDiagnostics(y, "married_joint").amt.bound).toBe(true);
  });
});

describe("buildDiagnostics — rate and headroom in an AMT year (F5)", () => {
  function amtYear(nextDollarFederalRate?: number) {
    const y = fixtureYear();
    y.taxResult!.flow.amtAdditional = 208_800;
    (y.taxResult!.diag as { nextDollarFederalRate?: number }).nextDollarFederalRate =
      nextDollarFederalRate;
    return y;
  }

  it("reports the true next-dollar rate, not the bracket lookup", () => {
    expect(buildDiagnostics(amtYear(0.42), "married_joint").marginalRate).toBe(0.42);
  });

  it("drops the '$X to next bracket' hint — that room is not available at the stated rate", () => {
    expect(buildDiagnostics(amtYear(0.42), "married_joint").bracketHeadroom).toBeNull();
  });

  it("falls back to the bracket rate when no measurement was taken", () => {
    expect(buildDiagnostics(amtYear(), "married_joint").marginalRate).toBe(0.24);
  });

  it("still suppresses the headroom hint without a measurement", () => {
    expect(buildDiagnostics(amtYear(), "married_joint").bracketHeadroom).toBeNull();
  });

  it("leaves an ordinary year's rate and headroom alone", () => {
    const d = buildDiagnostics(fixtureYear(), "married_joint");
    expect(d.marginalRate).toBe(0.24);
    expect(d.bracketHeadroom).toBe(25_000);
  });
});
