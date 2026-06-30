import { describe, it, expect } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear } from "@/engine/types";
import { buildTaxComparisonData } from "../view-model";
import { TAX_COMPARISON_OPTIONS_DEFAULT } from "../options-schema";

// Rich tax year: feeds buildTaxPaidBars, computeLifetimeTotals, buildTaxBracketRows.
function makeYear(
  year: number,
  marginalRate: number,
  totalTax: number,
  opts: Partial<{ irmaa: number; gain: number }> = {},
): ProjectionYear {
  return {
    year,
    ages: { client: 65, spouse: null },
    accountLedgers: { ira: { endingValue: 400_000 }, roth: { endingValue: 100_000 } },
    medicare: { totalIrmaaSurcharge: opts.irmaa ?? 0 },
    taxDetail: { capitalGains: opts.gain ?? 0 },
    taxResult: {
      flow: { totalFederalTax: totalTax * 0.75, stateTax: totalTax * 0.25, capitalGainsTax: 0, totalTax, incomeTaxBase: 120_000 },
      income: { grossTotalIncome: 150_000 },
      diag: {
        marginalFederalRate: marginalRate,
        marginalBracketTier: { from: 0, to: null, rate: marginalRate },
        incomeBracketsForFiling: [{ from: 0, to: null, rate: marginalRate }],
      },
    },
  } as unknown as ProjectionYear;
}

function bundle(years: ProjectionYear[], rothEnding: number, scenarioLabel: string, taxEngineMode: "flat" | "bracket") {
  return {
    clientData: {
      client: { dateOfBirth: "1965-01-01", retirementAge: 65 }, // retires 2030
      accounts: [
        { id: "ira", category: "retirement", subType: "traditional_ira" },
        { id: "roth", category: "retirement", subType: "roth_ira" },
      ],
      planSettings: { taxEngineMode },
    },
    projection: { years: years.map((y) => ({ ...y, accountLedgers: { ira: { endingValue: 400_000 }, roth: { endingValue: rothEnding } } })) },
    scenarioLabel,
  } as never;
}

// Base pays more tax and lands in a high bracket; scenario pays less and holds more Roth.
const baseYears = [makeYear(2030, 0.32, 60_000, { irmaa: 1_500 }), makeYear(2031, 0.32, 60_000)];
const scnYears = [makeYear(2030, 0.12, 40_000), makeYear(2031, 0.12, 40_000)];

function ctxFor(mode: "flat" | "bracket"): BuildDataContext {
  return {
    bundlesByRef: {
      base: bundle(baseYears, 100_000, "Base Case", mode),
      "scenario:s1": bundle(scnYears, 350_000, "Delay + Roth", mode),
    },
  } as unknown as BuildDataContext;
}

const opts = { ...TAX_COMPARISON_OPTIONS_DEFAULT, scenarioId: "s1" };

describe("buildTaxComparisonData", () => {
  it("is empty when no scenario is picked", () => {
    const d = buildTaxComparisonData(ctxFor("bracket"), TAX_COMPARISON_OPTIONS_DEFAULT);
    expect(d.isEmpty).toBe(true);
  });

  it("builds five delta KPIs with lower-is-better favorability", () => {
    const d = buildTaxComparisonData(ctxFor("bracket"), opts);
    expect(d.isEmpty).toBe(false);
    expect(d.kpis.map((k) => k.label)).toEqual([
      "Lifetime Federal Tax", "Lifetime State Tax", "Lifetime Capital Gains Tax",
      "Lifetime Total Tax", "Lifetime Effective Rate",
    ]);
    const total = d.kpis.find((k) => k.label === "Lifetime Total Tax")!;
    expect(total.base).toBe("$120k");   // 60k + 60k
    expect(total.scenario).toBe("$80k"); // 40k + 40k
    expect(total.delta.startsWith("−")).toBe(true); // scenario saves
    expect(total.direction).toBe(1);    // favorable
  });

  it("builds the chart with the base total overlaid per year", () => {
    const d = buildTaxComparisonData(ctxFor("bracket"), opts);
    expect(d.chart).toHaveLength(2);
    expect(d.chart[0].total).toBe(40_000);    // scenario stack
    expect(d.chart[0].baseTotal).toBe(60_000); // base overlay line
  });

  it("compares bracket exposure in bracket mode and nulls it in flat mode", () => {
    const bracket = buildTaxComparisonData(ctxFor("bracket"), opts).bracket!;
    const aboveHigh = bracket.find((r) => r.label.includes("above"))!;
    expect(aboveHigh.base).toBe("2");      // base in 0.32 both years
    expect(aboveHigh.scenario).toBe("0");  // scenario in 0.12
    expect(aboveHigh.direction).toBe(1);   // fewer high-bracket years = favorable
    const belowLow = bracket.find((r) => r.label.includes("below"))!;
    expect(belowLow.direction).toBe(0);    // neutral
    expect(buildTaxComparisonData(ctxFor("flat"), opts).bracket).toBeNull();
  });

  it("compares Roth/pre-tax/taxable composition at retirement", () => {
    const c = buildTaxComparisonData(ctxFor("bracket"), opts).composition!;
    expect(c.year).toBe(2030);
    expect(c.base.roth).toBe(100_000);
    expect(c.scenario.roth).toBe(350_000);
  });

  it("opens the narrative with the lifetime-tax reduction", () => {
    const d = buildTaxComparisonData(ctxFor("bracket"), opts);
    expect(d.narrative[0]).toContain("lowers");
  });
});
