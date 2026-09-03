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
    portfolioAssets: { cash: {}, taxable: {}, retirement: { ira: 400_000, roth: 100_000 } },
    medicare: { totalIrmaaSurcharge: opts.irmaa ?? 0 },
    taxDetail: { capitalGains: opts.gain ?? 0 },
    taxResult: {
      flow: { totalFederalTax: totalTax * 0.75, stateTax: totalTax * 0.25, capitalGainsTax: 0, fica: 0, totalTax, incomeTaxBase: 120_000 },
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
    projection: {
      years: years.map((y) => ({
        ...y,
        accountLedgers: { ira: { endingValue: 400_000 }, roth: { endingValue: rothEnding } },
        portfolioAssets: { cash: {}, taxable: {}, retirement: { ira: 400_000, roth: rothEnding } },
      })),
    },
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

  it("builds six delta KPIs with lower-is-better favorability", () => {
    const d = buildTaxComparisonData(ctxFor("bracket"), opts);
    expect(d.isEmpty).toBe(false);
    // A3: the four amount rows are disjoint slices of the total below them —
    // federal net of capital gains, and payroll itemized rather than implied.
    expect(d.kpis.map((k) => k.label)).toEqual([
      "Federal (ordinary)", "Capital Gains Tax", "State Tax", "Payroll Tax",
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
    expect(c.baseYear).toBe(2030);
    expect(c.scenarioYear).toBe(2030);
    expect(c.base.roth).toBe(100_000);
    expect(c.scenario.roth).toBe(350_000);
  });

  it("names each side's own retirement year when the two plans differ", () => {
    // The scenario retires a year later. The page used to print only the
    // scenario's year over both columns, dating the base figure wrongly.
    const scnBundle = bundle(scnYears, 350_000, "Retire a year later", "bracket") as unknown as {
      clientData: { client: { retirementAge: number } };
    };
    scnBundle.clientData.client.retirementAge = 66; // retires 2031
    const ctx = {
      bundlesByRef: { base: bundle(baseYears, 100_000, "Base Case", "bracket"), "scenario:s1": scnBundle },
    } as unknown as BuildDataContext;
    const c = buildTaxComparisonData(ctx, opts).composition!;
    expect(c.baseYear).toBe(2030);
    expect(c.scenarioYear).toBe(2031);
  });

  it("dates each side by the year it measured, not the year it asked for", () => {
    // The scenario's retirement year is past the end of its projection;
    // computeRetirementComposition falls back to the first row.
    const scnBundle = bundle(scnYears, 350_000, "Retire much later", "bracket") as unknown as {
      clientData: { client: { retirementAge: number } };
    };
    scnBundle.clientData.client.retirementAge = 80; // 2045 — not projected
    const ctx = {
      bundlesByRef: { base: bundle(baseYears, 100_000, "Base Case", "bracket"), "scenario:s1": scnBundle },
    } as unknown as BuildDataContext;
    const c = buildTaxComparisonData(ctx, opts).composition!;
    expect(c.scenarioYear).toBe(2030);
  });

  it("opens the narrative with the lifetime-tax reduction", () => {
    const d = buildTaxComparisonData(ctxFor("bracket"), opts);
    expect(d.narrative[0]).toContain("lowers");
  });

  it("reads the LEFT side from the chosen baseline and names both sides", () => {
    // s2's years pay far less tax than base's, so a lifetime total read off the
    // wrong bundle is visible in the assertion, not just in coverage.
    const ctx = ctxFor("bracket");
    const threeWay = {
      bundlesByRef: {
        ...(ctx.bundlesByRef as Record<string, unknown>),
        "scenario:s2": bundle(scnYears, 100_000, "Retire at 62", "bracket"),
      },
    } as unknown as BuildDataContext;

    const opts = { ...TAX_COMPARISON_OPTIONS_DEFAULT, scenarioId: "s1", baselineScenarioId: "s2" };
    const d = buildTaxComparisonData(threeWay, opts);

    expect(d.isEmpty).toBe(false);
    expect(d.baselineLabel).toBe("Retire at 62");
    expect(d.subtitle).toContain("Retire at 62 vs.");
    // Both sides now read the low-tax fixture, so the two columns must match.
    // Against the default `base` baseline (the high-tax fixture) they differ —
    // which is what makes reading the wrong bundle visible here.
    const lifetime = d.kpis.find((k) => k.label === "Lifetime Total Tax")!;
    expect(lifetime.base).toBe(lifetime.scenario);

    const againstBase = buildTaxComparisonData(threeWay, { ...opts, baselineScenarioId: "base" });
    const lifetimeVsBase = againstBase.kpis.find((k) => k.label === "Lifetime Total Tax")!;
    expect(lifetimeVsBase.base).not.toBe(lifetimeVsBase.scenario);
  });

  it("renders the empty state when the chosen baseline was not loaded", () => {
    const opts = { ...TAX_COMPARISON_OPTIONS_DEFAULT, scenarioId: "s1", baselineScenarioId: "missing" };
    expect(buildTaxComparisonData(ctxFor("bracket"), opts).isEmpty).toBe(true);
  });
});
