import { describe, it, expect } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear, ClientData } from "@/engine/types";
import { buildTaxSummaryData } from "../view-model";
import { TAX_SUMMARY_OPTIONS_DEFAULT } from "../options-schema";

// Two-year bracket-mode plan with a Roth conversion in year 2.
function makeYear(year: number, marginalRate: number, opts: Partial<{ conversionGross: number; conversionTaxable: number; irmaa: number; gain: number }> = {}): ProjectionYear {
  return {
    year,
    ages: { client: 65, spouse: null },
    accountLedgers: {
      ira: { endingValue: 400_000 },
      roth: { endingValue: 100_000 },
    },
    medicare: { totalIrmaaSurcharge: opts.irmaa ?? 0 },
    taxDetail: { capitalGains: opts.gain ?? 0 },
    rothConversions: opts.conversionGross
      ? [{ id: "c1", name: "Fill 22%", gross: opts.conversionGross, taxable: opts.conversionTaxable ?? opts.conversionGross }]
      : undefined,
    taxResult: {
      flow: { totalFederalTax: 20_000, stateTax: 4_000, capitalGainsTax: 1_000, totalTax: 24_000, incomeTaxBase: 120_000 },
      income: { grossTotalIncome: 150_000 },
      diag: {
        marginalFederalRate: marginalRate,
        marginalBracketTier: { from: 0, to: null, rate: marginalRate },
        incomeBracketsForFiling: [{ from: 0, to: null, rate: marginalRate }],
      },
    },
  } as unknown as ProjectionYear;
}

function ctxFor(years: ProjectionYear[], taxEngineMode: "flat" | "bracket"): BuildDataContext {
  const clientData = {
    client: { dateOfBirth: "1965-01-01", retirementAge: 65 }, // retires 2030
    accounts: [
      { id: "ira", category: "retirement", subType: "traditional_ira" },
      { id: "roth", category: "retirement", subType: "roth_ira" },
    ],
    planSettings: { taxEngineMode },
  } as unknown as ClientData;
  return { years, clientData, scenarioLabel: "Base Plan" } as unknown as BuildDataContext;
}

describe("buildTaxSummaryData", () => {
  it("builds KPIs, bars, bracket exposure, composition, and an opportunities page in bracket mode", () => {
    const years = [makeYear(2030, 0.12, { conversionGross: 50_000, conversionTaxable: 45_000 }), makeYear(2031, 0.32, { irmaa: 1_500 })];
    const data = buildTaxSummaryData(ctxFor(years, "bracket"), TAX_SUMMARY_OPTIONS_DEFAULT);

    expect(data.isEmpty).toBe(false);
    expect(data.bracketMode).toBe(true);
    expect(data.kpis.lifetimeFederal).toBe(40_000);
    expect(data.kpis.lifetimeTotal).toBe(48_000);
    expect(data.chart).toHaveLength(2);
    expect(data.bracket?.yearsBelowLow).toBe(1);   // 0.12
    expect(data.bracket?.yearsAboveHigh).toBe(1);  // 0.32
    expect(data.composition?.roth).toBe(100_000);
    expect(data.composition?.preTax).toBe(400_000);
    expect(data.opportunities).not.toBeNull();
    expect(data.opportunities?.rothConversions).toHaveLength(1);
    expect(data.opportunities?.irmaa).toHaveLength(1);
    expect(data.narrative[0]).toContain("%");
  });

  it("suppresses bracket UI in flat mode and omits the opportunities page when no signals fire", () => {
    const years = [makeYear(2030, 0.25), makeYear(2031, 0.25)];
    const data = buildTaxSummaryData(ctxFor(years, "flat"), TAX_SUMMARY_OPTIONS_DEFAULT);
    expect(data.bracketMode).toBe(false);
    expect(data.bracket).toBeNull();
    expect(data.opportunities).toBeNull();
  });

  it("returns an empty state when no year has a taxResult", () => {
    const years = [{ year: 2030, accountLedgers: {} } as unknown as ProjectionYear];
    const data = buildTaxSummaryData(ctxFor(years, "bracket"), TAX_SUMMARY_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(true);
  });
});
