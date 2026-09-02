import { describe, it, expect } from "vitest";
import {
  buildScenarioComparisonData,
  truncateToSentences,
  narrativeSentenceBudget,
} from "./view-model";
import { estimateScenarioComparisonPageCount } from "./estimate-page-count";
import { summarizeScenarioComparisonOptions } from "./summarize-options";
import { SCENARIO_COMPARISON_OPTIONS_DEFAULT } from "./options-schema";
import type { ScenarioComparisonOptions } from "./types";

// Only the fields this page reads are populated; the rest is cast, because the
// page must not depend on shape it never touches.
function year(y: number, liquid: number, tax: number) {
  return {
    year: y,
    portfolioAssets: {
      liquidTotal: liquid, cashTotal: 0, retirementTotal: liquid, taxableTotal: 0,
    },
    expenses: { taxes: tax },
    taxResult: {
      flow: { totalFederalTax: tax * 0.75, stateTax: tax * 0.25,
              capitalGainsTax: 0, fica: 0, totalTax: tax },
      income: { grossTotalIncome: tax * 4 },
    },
  } as never;
}

// `retirementYearOf` reads dateOfBirth + retirementAge — there is no
// `retirementYear` field on ClientInfo. 1988 + 62 lands on 2050, the fixture's
// first projection row, so "at retirement" and "end of life" read different
// rows and a wrong-row swap would fail the assertions below.
const CLIENT = {
  firstName: "A", lastName: "B", spouseName: null,
  dateOfBirth: "1988-04-01", retirementAge: 62,
};

function bundle(
  label: string,
  liquid: number,
  success: number | null,
  over: Record<string, unknown> = {},
) {
  const years = [year(2050, liquid, 40_000), year(2075, liquid * 2, 30_000)];
  return {
    scenarioLabel: label,
    clientData: { client: { ...CLIENT } },
    projection: { years },
    monteCarlo: success == null ? null : {
      summary: { successRate: success, ending: { p20: liquid / 2 } },
    },
    // MaxSpendResult's today's-dollar figure is `realAnnualSpend`.
    maxSpend: { realAnnualSpend: 164_000 },
    ...over,
  } as never;
}

function ctx(over: Record<string, unknown> = {}) {
  return {
    years: [year(2050, 2_400_000, 40_000), year(2075, 4_400_000, 30_000)],
    projection: { years: [] },
    clientData: { client: { ...CLIENT } },
    scenarioLabel: "Base Case",
    clientName: "A B", spouseName: null, spouseLastName: null,
    firmName: "F", firmTagline: null, reportDate: "2026-01-01",
    firmLogoDataUrl: null, accentColor: "#000",
    bundlesByRef: {
      base: bundle("Base Case", 2_400_000, 0.73),
      "scenario:s1": bundle("Retire at 62", 2_100_000, 0.82),
    },
    ...over,
  } as never;
}

const opts = (over: Partial<ScenarioComparisonOptions> = {}): ScenarioComparisonOptions =>
  ({ ...SCENARIO_COMPARISON_OPTIONS_DEFAULT, ...over });

describe("buildScenarioComparisonData", () => {
  it("returns the empty state with no scenarios chosen", () => {
    const d = buildScenarioComparisonData(ctx(), opts());
    expect(d.isEmpty).toBe(true);
    expect(d.columns).toEqual([]);
    expect(estimateScenarioComparisonPageCount(d)).toBe(1);
  });

  it("puts Base Case first and the chosen scenarios after it", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"] }));
    expect(d.isEmpty).toBe(false);
    expect(d.columns.map((c) => c.name)).toEqual(["Base Case", "Retire at 62"]);
    expect(d.columns[0].refKey).toBe("base");
    expect(estimateScenarioComparisonPageCount(d)).toBe(2);
  });

  it("drops a column whose bundle is missing instead of crashing", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1", "ghost"] }));
    expect(d.columns.map((c) => c.refKey)).toEqual(["base", "s1"]);
  });

  it("de-duplicates a repeated scenario id", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1", "s1"] }));
    expect(d.columns).toHaveLength(2);
  });

  it("returns the empty state when the base bundle is absent", () => {
    const d = buildScenarioComparisonData(
      ctx({ bundlesByRef: { "scenario:s1": bundle("Retire at 62", 2_100_000, 0.82) } }),
      opts({ scenarioIds: ["s1"] }),
    );
    expect(d.isEmpty).toBe(true);
  });

  it("notes an unavailable Monte Carlo in the footnote", () => {
    const d = buildScenarioComparisonData(
      ctx({ bundlesByRef: {
        base: bundle("Base Case", 2_400_000, null),
        "scenario:s1": bundle("Retire at 62", 2_100_000, 0.82),
      } }),
      opts({ scenarioIds: ["s1"] }),
    );
    expect(d.footnote).toMatch(/confidence/i);
  });

  it("gives Base Case the fixed descriptor", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"] }));
    expect(d.columns[0].descriptor).toEqual(["Your plan as it stands today."]);
  });

  it("reads assets at retirement off the retirement-year row, not the last row", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"] }));
    const atRetirement = d.rows.find((r) => r.label === "Assets at retirement")!;
    const endOfLife = d.rows.find((r) => r.label === "Assets end of life")!;
    // 2050 row is $2.4M; the 2075 row is $4.8M. Reading the wrong row would
    // make these two cells identical.
    expect(atRetirement.cells[0].value).toBe("$2.4M");
    expect(endOfLife.cells[0].value).toBe("$4.8M");
  });

  it("prints max sustainable spending from the solver's today's-dollar figure", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"] }));
    const row = d.rows.find((r) => r.label === "Max sustainable spending")!;
    expect(row.cells[0].value).toBe("$164k");
  });

  it("omits the chart when the option is off", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"], showChart: false }));
    expect(d.chart).toBeNull();
  });

  it("draws one chart line per column with no stacked bars", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"] }));
    expect(d.chart!.lines).toHaveLength(2);
    expect(d.chart!.stacks).toEqual([]);
  });

  it("carries a gap, not a zero, past a plan that ends early", () => {
    const d = buildScenarioComparisonData(
      ctx({ bundlesByRef: {
        base: bundle("Base Case", 2_400_000, 0.73),
        "scenario:s1": bundle("Retire at 62", 2_100_000, 0.82, {
          projection: { years: [year(2050, 2_100_000, 40_000)] },
        }),
      } }),
      opts({ scenarioIds: ["s1"] }),
    );
    // The chart domain is the UNION of both plans' years, so the short plan
    // needs a value for 2075. A zero would draw a cliff the plan does not have.
    expect(d.chart!.xAxis.domain).toEqual([2050, 2075]);
    const short = d.chart!.lines[1].values;
    expect(short[0]).toBe(2_100_000);
    expect(Number.isNaN(short[1])).toBe(true);
  });

  it("emits one retirement marker per distinct year, not one per column", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"] }));
    // Both columns retire in 2050. Four columns sharing a year would otherwise
    // stack four identical dashed rules on the same x.
    expect(d.chart!.markers).toHaveLength(1);
    expect(d.chart!.markers[0].atX).toBe(2050);
    expect(d.chart!.markers[0].label).toBe("Retirement");
  });

  it("keeps the retirement marker on a year the chart actually plots", () => {
    // An already-retired client's derived retirement year (1970 + 65 = 2035)
    // precedes the projection. The marker must snap onto a real row: an
    // off-domain `atX` has no band, so the renderer pins it to the left edge
    // and silently annotates the wrong year.
    const retired = { ...CLIENT, dateOfBirth: "1970-02-01", retirementAge: 65 };
    const d = buildScenarioComparisonData(
      ctx({ bundlesByRef: {
        base: bundle("Base Case", 2_400_000, 0.73, { clientData: { client: retired } }),
        "scenario:s1": bundle("Retire at 62", 2_100_000, 0.82, {
          clientData: { client: retired },
        }),
      } }),
      opts({ scenarioIds: ["s1"] }),
    );
    for (const m of d.chart!.markers) {
      expect(d.chart!.xAxis.domain).toContain(m.atX);
    }
  });

  it("omits the bands when the option is off", () => {
    const d = buildScenarioComparisonData(
      ctx(), opts({ scenarioIds: ["s1"], showTradeoffBands: false }),
    );
    expect(d.bands).toEqual([]);
  });

  it("truncates a stored narrative to the band budget", () => {
    const long = "One. Two. Three. Four. Five. Six. Seven.";
    const d = buildScenarioComparisonData(ctx(), opts({
      scenarioIds: ["s1"],
      ai: { tone: "detailed", customInstructions: "",
            byScenario: { s1: { generatedText: long, generatedAt: null, sourceHash: "h" } } },
    }));
    const sentences = d.bands[0].narrative.match(/[.!?]/g) ?? [];
    expect(sentences.length).toBeLessThanOrEqual(narrativeSentenceBudget(1));
  });

  it("omits the Net to heirs row when the plans carry no estate data", () => {
    const d = buildScenarioComparisonData(ctx(), opts({ scenarioIds: ["s1"] }));
    expect(d.rows.find((r) => r.label === "Net to heirs")).toBeUndefined();
  });

  it("reports a real Net to heirs figure when the projection carries death events", () => {
    const d = buildScenarioComparisonData(
      ctx({ bundlesByRef: {
        base: withEstate(bundle("Base Case", 2_400_000, 0.73), 1_000_000),
        "scenario:s1": withEstate(bundle("Retire at 62", 2_100_000, 0.82), 1_400_000),
      } }),
      opts({ scenarioIds: ["s1"] }),
    );
    const row = d.rows.find((r) => r.label === "Net to heirs")!;
    expect(row.cells[0].value).toBe("$1.0M");
    expect(row.cells[1].value).toBe("$1.4M");
    // More to the heirs is a gain, so the delta must read as favourable.
    expect(row.cells[1].direction).toBe(1);
  });
});

/** Adds a first-death event and the matching year row's transfers, so
 *  `netToHeirsEol` composes a non-empty estate transfer report. */
function withEstate(base: unknown, toHeirs: number) {
  const b = base as {
    clientData: { client: Record<string, unknown> };
    projection: { years: Array<{ year: number }> };
  };
  const deathYear = 2075;
  const estateTax = {
    year: deathYear, deathOrder: 1, deceased: "client",
    grossEstate: toHeirs, grossEstateLines: [], estateAdminExpenses: 0,
    maritalDeduction: 0, charitableDeduction: 0, taxableEstate: toHeirs,
    federalEstateTax: 0, stateEstateTax: 0, probateCost: 0,
    drainAttributions: [], estateTaxDebits: [], creditorPayoffDebits: [],
  };
  const transfers = [{
    year: deathYear, deathOrder: 1, deceased: "client",
    sourceAccountId: "acc-1", sourceAccountName: "Brokerage",
    sourceLiabilityId: null, sourceLiabilityName: null,
    via: "will", recipientKind: "family_member", recipientId: "fm-child",
    recipientLabel: "Alex", amount: toHeirs, basis: toHeirs / 2,
    resultingAccountId: null, resultingLiabilityId: null,
  }];
  return {
    ...(base as object),
    clientData: {
      client: b.clientData.client,
      accounts: [], entities: [], externalBeneficiaries: [], wills: [],
      familyMembers: [
        { id: "fm-child", role: "child", relationship: "child",
          firstName: "Alex", lastName: null, dateOfBirth: "2010-01-01" },
      ],
    },
    projection: {
      years: b.projection.years.map((y) =>
        y.year === deathYear ? { ...y, deathTransfers: transfers } : y,
      ),
      firstDeathEvent: estateTax,
      secondDeathEvent: null,
    },
  } as never;
}

describe("truncateToSentences", () => {
  it("keeps text already within budget", () => {
    expect(truncateToSentences("One. Two.", 3)).toBe("One. Two.");
  });
  it("cuts at a sentence boundary", () => {
    expect(truncateToSentences("One. Two. Three. Four.", 2)).toBe("One. Two.");
  });
  it("handles text with no terminator", () => {
    expect(truncateToSentences("no full stop here", 1)).toBe("no full stop here");
  });
});

describe("narrativeSentenceBudget", () => {
  it("shrinks the budget as columns are added", () => {
    expect(narrativeSentenceBudget(1)).toBeGreaterThan(narrativeSentenceBudget(3));
    expect(narrativeSentenceBudget(3)).toBe(3);
  });
});

describe("summarizeScenarioComparisonOptions", () => {
  it("says so when nothing is selected", () => {
    expect(summarizeScenarioComparisonOptions(opts())).toMatch(/No scenarios selected/);
  });
  it("counts the scenarios and names the max-spend confidence", () => {
    expect(summarizeScenarioComparisonOptions(opts({ scenarioIds: ["s1", "s2"] })))
      .toBe("2 scenarios · max spend at 85%");
  });
});
