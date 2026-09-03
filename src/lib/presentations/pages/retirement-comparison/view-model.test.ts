import { describe, it, expect } from "vitest";
import { buildRetirementComparisonData } from "./view-model";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "./options-schema";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { runProjectionWithEvents } from "@/engine";
import { buildMarriedEstateFixture } from "@/engine/__tests__/fixtures/married-estate-fixture";
import { estateDistributionAtYear } from "@/lib/estate/estate-distribution-at-year";
import { fmtUsdCompact } from "./format";

// Minimal ProjectionYear factory (only fields the view-model reads).
function py(
  year: number,
  liquid: number,
  tax: number,
  clientAge: number,
  retirement: Record<string, number> = {},
  ledgers: Record<string, { rothValueEoY?: number }> = {},
): ProjectionYear {
  return {
    year,
    ages: { client: clientAge, spouse: null },
    portfolioAssets: {
      liquidTotal: liquid,
      cashTotal: liquid,
      retirementTotal: Object.values(retirement).reduce((s, v) => s + v, 0),
      taxableTotal: 0,
      retirement,
    },
    accountLedgers: ledgers,
    expenses: { taxes: tax },
    income: { total: 0 },
    withdrawals: { total: 0 },
    totalExpenses: 0,
  } as unknown as ProjectionYear;
}

function byYearRow(year: number, p20: number, p50: number, p80: number) {
  return { year, age: { client: 70 }, balance: { p5: 0, p20, p50, p80, p95: 0, min: 0, max: 0 }, cagrFromStart: null };
}

function bundle(
  years: ProjectionYear[],
  success: number,
  maxSpend: number,
  accounts: { id: string; subType: string }[] = [],
  endP20 = 100,
  retirementAge = 65,
  scenarioLabel = "Delay + Roth",
) {
  return {
    clientData: {
      client: { dateOfBirth: "1965-01-01", retirementAge },
      planSettings: { planStartYear: 2026, inflationRate: 0.0 }, // 0% inflation → flat series
      accounts,
    },
    projection: { years },
    scenarioLabel,
    monteCarlo: {
      summary: {
        successRate: success,
        byYear: years.map((y, i) => byYearRow(y.year, i === years.length - 1 ? endP20 : 100, 200, 300)),
      },
    },
    maxSpend: { realAnnualSpend: maxSpend, scaleFactor: 1, achievedPoS: success, status: "converged" },
  } as never;
}

// Base depletes; scenario funded. Scenario holds a Roth IRA at retirement.
const baseYears = [py(2030, 1_000_000, 50_000, 65), py(2031, 10_000, 40_000, 66)];
const scnYears = [
  py(2030, 1_200_000, 30_000, 65, { r: 400_000, k: 600_000 }, { k: { rothValueEoY: 200_000 } }),
  py(2031, 900_000, 25_000, 66, { r: 500_000 }),
];
const scnAccounts = [
  { id: "r", subType: "roth_ira" },
  { id: "k", subType: "401k" },
];

const ctx = {
  bundlesByRef: {
    base: bundle(baseYears, 0.73, 90_000, [], 1_500_000, 65, "Base Case"),
    "scenario:s1": bundle(scnYears, 0.91, 110_000, scnAccounts, 13_900_000),
  },
} as unknown as BuildDataContext;

const opts = { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT, scenarioId: "s1" };

describe("buildRetirementComparisonData", () => {
  it("builds the verdict headline from success rates", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.isEmpty).toBe(false);
    expect(d.verdict.headline).toContain("91%");
    expect(d.verdict.headline).toContain("73%");
  });

  it("exposes both plans' max spend (today's $) and a series", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.maxSpend.show).toBe(true);
    expect(d.maxSpend.baseToday).toBe(90_000);
    expect(d.maxSpend.scenarioToday).toBe(110_000);
    expect(d.maxSpend.series.length).toBeGreaterThan(0);
  });

  it("builds the 5 headline KPIs that improve, retirement age first", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    const labels = d.kpis.map((k) => k.label);
    expect(labels).toEqual([
      "Retirement age",
      "Plan confidence",
      "Legacy to heirs",
      "Max sustainable spend",
      "Downside ending balance",
    ]);
    const success = d.kpis[1];
    expect(success.base).toBe("73%");
    expect(success.scenario).toBe("91%");
    expect(success.delta).toBe("+18 pts");
    const maxSpend = d.kpis[3];
    expect(maxSpend.base).toBe("$90K/yr");
    expect(maxSpend.scenario).toBe("$110K/yr");
    const downside = d.kpis[4];
    expect(downside.base).toBe("$1.5M");
    expect(downside.scenario).toBe("$13.9M");
  });

  // These hand-built projection rows carry no per-year hypothetical estate
  // tax, so there is no after-tax figure to print. The card must go dark
  // rather than fall back to the end-of-life portfolio total — printing the
  // gross under this label is the defect, not a degraded version of it.
  it("shows the legacy card dark when the projection carries no estate model", () => {
    const legacy = buildRetirementComparisonData(ctx, opts).kpis[2];
    expect(legacy.label).toBe("Legacy to heirs");
    expect(legacy.show).toBe(false);
    expect(legacy.base).toBe("—");
    expect(legacy.scenario).toBe("—");
    expect(legacy.delta).toBe("");
  });

  // The strip printed every delta in the success colour whichever way it moved,
  // and the renderers had nothing to branch on. Direction is the fix, and the
  // sign of the delta is NOT a stand-in for it — see the retirement-age case.
  it("marks an all-improving scenario good, and legacy neutral either way", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.kpis.map((k) => [k.label, k.direction])).toEqual([
      ["Retirement age", 0],            // both retire at 65 — no move, no tone
      ["Plan confidence", 1],
      ["Legacy to heirs", 0],           // neutral by design, though it ROSE here
      ["Max sustainable spend", 1],
      ["Downside ending balance", 1],
    ]);
  });

  it("marks a scenario that gives up confidence, spend and downside bad", () => {
    // Every figure moves the other way from `ctx`: 73% → 60% confidence,
    // $110K → $70K of spend, $13.9M → $0.4M of downside balance, and less
    // legacy. Only legacy should hold its tone.
    const worse = {
      bundlesByRef: {
        base: bundle(scnYears, 0.73, 110_000, scnAccounts, 13_900_000, 65),
        "scenario:s1": bundle(baseYears, 0.6, 70_000, [], 400_000, 65),
      },
    } as unknown as BuildDataContext;
    const d = buildRetirementComparisonData(worse, opts);
    expect(d.kpis.map((k) => [k.label, k.delta, k.direction])).toEqual([
      ["Retirement age", "", 0],
      ["Plan confidence", "−13 pts", -1],
      // Blank, not "−$890K": these fixtures carry no estate model, so there is
      // no after-tax legacy to state. The real-engine block below proves the
      // figure itself.
      ["Legacy to heirs", "", 0],
      ["Max sustainable spend", "−$40K/yr", -1],
      ["Downside ending balance", "−$13.5M", -1],
    ]);
  });

  // Retiring five years earlier is the headline change an advisor makes, and
  // the strip never named it — the deck showed only its consequences.
  it("prints each plan's retirement age, and a signed year delta", () => {
    const earlier = {
      bundlesByRef: {
        base: bundle(baseYears, 0.73, 90_000, [], 1_500_000, 65),
        "scenario:s1": bundle(scnYears, 0.91, 110_000, scnAccounts, 13_900_000, 60),
      },
    } as unknown as BuildDataContext;
    const age = buildRetirementComparisonData(earlier, opts).kpis[0];
    expect(age.label).toBe("Retirement age");
    expect(age.base).toBe("65");
    expect(age.scenario).toBe("60");
    expect(age.delta).toBe("−5 yrs");
    expect(age.show).toBe(true);
    // The tone is the OPPOSITE of the sign here: five years earlier is good.
    expect(age.direction).toBe(1);
  });

  it("marks a later retirement age bad, mirroring the earlier-is-good case", () => {
    const later = {
      bundlesByRef: {
        base: bundle(baseYears, 0.73, 90_000, [], 1_500_000, 65),
        "scenario:s1": bundle(scnYears, 0.91, 110_000, scnAccounts, 13_900_000, 70),
      },
    } as unknown as BuildDataContext;
    const age = buildRetirementComparisonData(later, opts).kpis[0];
    expect(age.delta).toBe("+5 yrs");
    expect(age.direction).toBe(-1);
  });

  it("leaves the delta blank when neither plan moves the retirement age", () => {
    // Both fixtures retire at 65 — a "+0 yrs" chip would be noise.
    expect(buildRetirementComparisonData(ctx, opts).kpis[0].delta).toBe("");
  });

  it("singularises a one-year move", () => {
    const oneYear = {
      bundlesByRef: {
        base: bundle(baseYears, 0.73, 90_000, [], 1_500_000, 65),
        "scenario:s1": bundle(scnYears, 0.91, 110_000, scnAccounts, 13_900_000, 66),
      },
    } as unknown as BuildDataContext;
    expect(buildRetirementComparisonData(oneYear, opts).kpis[0].delta).toBe("+1 yr");
  });

  it("splits at-retirement assets by tax treatment for the scenario", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.atRetirement.baseYear).toBe(2030);
    expect(d.atRetirement.scenarioYear).toBe(2030);
    // Scenario 2030: cash 1.2M (liquidTotal), Roth IRA 400k + 401k Roth slice 200k = 600k,
    // pre-tax = 401k remainder 400k.
    expect(d.atRetirement.scenario.cash).toBe(1_200_000);
    expect(d.atRetirement.scenario.roth).toBe(600_000);
    expect(d.atRetirement.scenario.preTax).toBe(400_000);
    expect(d.atRetirement.scenario.hsa).toBe(0);
  });

  it("exposes the end-of-life breakdown for the condensed matrix", () => {
    const d = buildRetirementComparisonData(ctx, opts);
    expect(d.atEndOfLife.baseYear).toBe(2031);
    expect(d.atEndOfLife.scenarioYear).toBe(2031);
    expect(d.atEndOfLife.scenario.roth).toBe(500_000);
  });

  it("names both sides in the subtitle", () => {
    expect(buildRetirementComparisonData(ctx, opts).subtitle).toBe("Base Case vs. Delay + Roth");
  });

  it("reads the LEFT side from the chosen baseline, not from base", () => {
    // Three bundles loaded; the baseline points at s2, whose success rate is
    // 0.40 — a value neither base (0.73) nor the comparison scenario (0.91)
    // holds, so reading the wrong bundle is visible in the assertion.
    const threeWay = {
      bundlesByRef: {
        ...(ctx.bundlesByRef as Record<string, unknown>),
        "scenario:s2": bundle(baseYears, 0.40, 70_000, [], 900_000, 62, "Retire at 62"),
      },
    } as unknown as BuildDataContext;

    const d = buildRetirementComparisonData(threeWay, { ...opts, baselineScenarioId: "s2" });

    expect(d.isEmpty).toBe(false);
    expect(d.subtitle).toBe("Retire at 62 vs. Delay + Roth");
    expect(d.verdict.headline).toContain("40%");
    expect(d.verdict.headline).not.toContain("73%");
  });

  it("renders the empty state when the chosen baseline was not loaded", () => {
    const d = buildRetirementComparisonData(ctx, { ...opts, baselineScenarioId: "missing" });
    expect(d.isEmpty).toBe(true);
  });
});

// ── Each plan measured at its OWN retirement year ────────────────────────────
// Separate fixture: the base plan retires at 65 (2054) and the scenario at 60
// (2049), so a single shared year cannot describe both columns.
function retYr(year: number): ProjectionYear {
  const liquid = (year - 2039) * 100_000;
  return {
    year,
    ages: { client: year - 1989, spouse: null },
    portfolioAssets: {
      liquidTotal: liquid, cashTotal: 0, retirementTotal: liquid, taxableTotal: 0,
      cash: {}, taxable: {}, retirement: { ira: liquid },
    },
    accountLedgers: { ira: { endingValue: liquid } },
  } as unknown as ProjectionYear;
}

function retBundle(retirementAge: number, lastYear: number, scenarioLabel: string) {
  const years: ProjectionYear[] = [];
  for (let y = 2040; y <= lastYear; y++) years.push(retYr(y));
  return {
    clientData: {
      client: { dateOfBirth: "1989-01-01", retirementAge },
      accounts: [{ id: "ira", category: "retirement", subType: "traditional_ira" }],
      planSettings: { planStartYear: 2040, inflationRate: 0 },
    },
    projection: { years },
    scenarioLabel,
    monteCarlo: null,
    maxSpend: null,
  } as never;
}

function retCtx(over: { baseLastYear?: number } = {}): BuildDataContext {
  return {
    bundlesByRef: {
      base: retBundle(65, over.baseLastYear ?? 2070, "Base Case"),
      "scenario:s1": retBundle(60, 2070, "Retire at 60"),
    },
  } as unknown as BuildDataContext;
}

describe("buildRetirementComparisonData — each plan is measured at its own retirement", () => {
  it("measures the base plan at the base plan's retirement year, not the scenario's", () => {
    const d = buildRetirementComparisonData(retCtx(), opts);
    expect(d.atRetirement.baseYear).toBe(2054);
    expect(d.atRetirement.scenarioYear).toBe(2049);
    // 2054 → $1.5M for the base; reading it at the scenario's 2049 gave $1.0M.
    expect(d.atRetirement.base.preTax).toBe(1_500_000);
    expect(d.atRetirement.scenario.preTax).toBe(1_000_000);
  });

  it("labels the year it actually measured when the projection runs short", () => {
    // The base projection stops in 2050, four years before its retirement.
    // yearAt falls back to the last row — so the page must say 2050, not 2054.
    const d = buildRetirementComparisonData(retCtx({ baseLastYear: 2050 }), opts);
    expect(d.atRetirement.baseYear).toBe(2050);
    expect(d.atRetirement.base.preTax).toBe(1_100_000);
  });

  it("labels each side of the end-of-life horizon with the year it measured", () => {
    const d = buildRetirementComparisonData(retCtx({ baseLastYear: 2050 }), opts);
    expect(d.atEndOfLife.scenarioYear).toBe(2070);
    expect(d.atEndOfLife.baseYear).toBe(2050);
  });
});

// ── Legacy to heirs is what the heirs KEEP ───────────────────────────────────
//
// The card used to print `portfolioAssets.liquidTotal` at end of life — a
// PRE-tax number. A plan holding its money in pre-tax IRAs hands its heirs
// roughly a third less than that once IRD income tax, estate tax and probate
// come out, and printing the gross made a plan that skipped a Roth conversion
// look identical to one that did it. That is the comparison this page exists
// to make, so the guard is built to fail the moment the gross comes back:
// both sides below END WITH THE SAME $15.5M portfolio and differ only in how
// it is taxed on the way to the kid.
describe("Legacy to heirs — after tax, not the gross portfolio", () => {
  /** The canonical married-estate fixture: everything to the surviving spouse,
   *  then the whole estate to kid-a at the second death (2052). */
  function estateBundle(kind: "taxable" | "preTax") {
    const clientData = buildMarriedEstateFixture();
    clientData.planSettings.irdTaxRate = 0.35;
    clientData.planSettings.probateCostRate = 0.02;
    if (kind === "preTax") {
      const brok = clientData.accounts.find((a) => a.id === "client-brok")!;
      brok.category = "retirement";
      brok.subType = "traditional_ira";
      brok.basis = 0;
    }
    return {
      clientData,
      projection: runProjectionWithEvents(clientData),
      scenarioLabel: kind === "preTax" ? "All pre-tax" : "All taxable",
    } as never;
  }

  const estateCtx = {
    clientName: "John Smith",
    spouseName: "Spouse Test",
    bundlesByRef: { base: estateBundle("taxable"), "scenario:s1": estateBundle("preTax") },
  } as unknown as BuildDataContext;

  it("nets estate tax, probate and IRD out of the end-of-life portfolio", () => {
    const d = buildRetirementComparisonData(estateCtx, opts);
    const legacy = d.kpis.find((k) => k.label === "Legacy to heirs")!;
    expect(legacy.show).toBe(true);

    // Both plans end with the same portfolio, so the OLD (gross) card printed
    // "$15.5M → $15.5M" and a blank move. Anything that prints the gross again
    // fails here.
    expect(d.atEndOfLife.base.cash + d.atEndOfLife.base.taxable + d.atEndOfLife.base.preTax)
      .toBeCloseTo(15_500_000, 0);
    expect(d.atEndOfLife.scenario.cash + d.atEndOfLife.scenario.taxable + d.atEndOfLife.scenario.preTax)
      .toBeCloseTo(15_500_000, 0);
    expect(legacy.base).not.toBe(legacy.scenario);
    expect(legacy.delta).not.toBe("");
  });

  it("equals the estate report's own toHeirs on both sides", () => {
    const d = buildRetirementComparisonData(estateCtx, opts);
    const legacy = d.kpis.find((k) => k.label === "Legacy to heirs")!;
    const ownerNames = { clientName: "John Smith", spouseName: "Spouse Test" };
    const expected = (kind: "taxable" | "preTax") => {
      const b = estateBundle(kind) as unknown as {
        clientData: ClientData;
        projection: ProjectionResult;
      };
      return estateDistributionAtYear({
        projection: b.projection,
        year: b.projection.secondDeathEvent!.year,
        clientData: b.clientData,
        ownerNames,
      }).toHeirs;
    };
    const baseHeirs = expected("taxable");
    const scnHeirs = expected("preTax");
    expect(legacy.base).toBe(fmtUsdCompact(baseHeirs));
    expect(legacy.scenario).toBe(fmtUsdCompact(scnHeirs));

    // And the fix is worth its weight: the all-pre-tax plan loses ~35% of the
    // same $15.5M to the heir's income tax, which the gross card hid entirely.
    expect(scnHeirs).toBeLessThan(baseHeirs * 0.75);
  });
});
