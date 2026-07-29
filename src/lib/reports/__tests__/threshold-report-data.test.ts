import { describe, it, expect } from "vitest";
import { buildThresholdReport } from "../threshold-report-data";
import { THRESHOLD_ITEMS } from "@/lib/tax/thresholds";
import type { ThresholdFacts, ThresholdHousehold } from "@/lib/tax/thresholds";
import type { TaxYearParameters } from "@/lib/tax/types";
import type { ProjectionYear } from "@/engine/types";

// Mirrors src/lib/tax/__tests__/thresholds.test.ts's fixture approach rather
// than inventing a second one.
const params = {
  rothPhaseout: { startMfj: 242000, endMfj: 252000, startSingle: 153000, endSingle: 168000 },
  iraDeduct: {
    coveredStartMfj: 129000, coveredEndMfj: 149000,
    coveredStartSingle: 81000, coveredEndSingle: 91000,
    spousalStartMfj: 242000, spousalEndMfj: 252000,
  },
  studentLoan: { maxDeduction: 2500, startMfj: 175000, endMfj: 205000, startSingle: 85000, endSingle: 100000 },
  ctc: { perChild: 2200, refundableMax: 1700, odcPerDependent: 500 },
  saversCredit: { mfj: [{ rate: 0.5, agiCeiling: 48500 }, { rate: 0.2, agiCeiling: 52500 }, { rate: 0.1, agiCeiling: 80500 }], single: [], hoh: [] },
  qbi: { thresholdMfj: 403550, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
  amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
  amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
} as unknown as TaxYearParameters;

const household: ThresholdHousehold = {
  filingStatus: "married_joint",
  qualifyingChildren: 1, otherDependents: 0, aotcStudents: 1,
  hasStudentLoanInterest: true, hasRothContribution: true,
  hasTraditionalIraContribution: true, hasQbi: true, hasInvestmentIncome: true,
  hasRetirementContributions: true,
  coveredSelf: true, coveredSpouse: false,
};

type Facts = Omit<ThresholdFacts, "params">;

const facts = (over: Partial<Facts> = {}): Facts => ({
  year: 2026, household,
  agi: 300000, magiForIraDeduction: 300000, magiForStudentLoan: 300000,
  magiForRoth: 300000, magiForCredits: 300000,
  taxableIncomeBeforeQbi: 300000, amti: 300000,
  ...over,
});

/** One small typed helper — this module is pure and takes ProjectionYear
 *  literals, never the engine's own output. */
const py = (thresholdFacts?: Facts): ProjectionYear =>
  ({ year: thresholdFacts?.year ?? 2026, thresholdFacts } as ProjectionYear);

describe("buildThresholdReport", () => {
  it("[brief] shows out in Alternative and full in Original when a mutation pushes MAGI over the threshold", () => {
    const scenario = py(facts({ magiForRoth: 300000 })); // above the 252,000 end
    const base = py(facts({ magiForRoth: 200000 }));      // below the 242,000 start
    const rows = buildThresholdReport({ year: 2026, scenario, base, params, household });
    const roth = rows.find((r) => r.id === "rothIra")!;
    expect(roth.alternativeStatus).toBe("out");
    expect(roth.originalStatus).toBe("full");
  });

  it("[R10.2] emits all 11 THRESHOLD_ITEMS, in order, with matching labels", () => {
    const rows = buildThresholdReport({
      year: 2026, scenario: py(facts()), base: py(facts()), params, household,
    });
    expect(rows.map((r) => r.id)).toEqual(THRESHOLD_ITEMS.map((i) => i.id));
    expect(rows.map((r) => r.label)).toEqual(THRESHOLD_ITEMS.map((i) => i.label));
  });

  it("[R10.3] marks every originalStatus na with no base plan, without blanking alternativeStatus", () => {
    const rows = buildThresholdReport({
      year: 2026,
      scenario: py(facts({ magiForRoth: 200000 })), // rothIra resolves "full", not "na"
      base: undefined,
      params, household,
    });
    expect(rows.every((r) => r.originalStatus === "na")).toBe(true);
    expect(rows.some((r) => r.alternativeStatus !== "na")).toBe(true);
  });

  it("[R10.4] marks every alternativeStatus na in flat mode, but still renders real ranges", () => {
    const scenario = { year: 2026 } as ProjectionYear; // no thresholdFacts: flat mode
    const rows = buildThresholdReport({ year: 2026, scenario, base: undefined, params, household });

    expect(rows.every((r) => r.alternativeStatus === "na")).toBe(true);

    // charitableLimit's SHARED cell is the rule, which holds with or without
    // facts; it is the PER-SIDE ceiling that has no AGI to compute from here.
    const charitable = rows.find((r) => r.id === "charitableLimit")!;
    expect(charitable.alternativeThresholdDisplay).toBe("—");
    // Every OTHER row still renders a real range off the household argument —
    // it does not need thresholdFacts to know the household's filing status.
    expect(rows.filter((r) => r.id !== "charitableLimit").every((r) => r.thresholdDisplay !== "—")).toBe(true);
  });

  it("[R10.5] formats thresholdDisplay per R7's precedence", () => {
    const rows = buildThresholdReport({
      year: 2026, scenario: py(facts({ agi: 300000 })), base: undefined, params, household,
    });

    // Two-ended range, exact string, " - " separator.
    expect(rows.find((r) => r.id === "rothIra")!.thresholdDisplay).toBe("$242,000 - $252,000");

    // Single-point (NIIT).
    expect(rows.find((r) => r.id === "niit")!.thresholdDisplay).toBe("$250,000");

    // AMT exemption end is the ONLY row whose range depends on the `year`
    // ARGUMENT rather than `params.year` (amtPhaseoutRate: 50% from 2026 per
    // OBBBA §70106, 25% before). Hand-computed, not via the code under test:
    // start 1,000,000 + exemption 140,200 / 0.5 = 1,280,400. This fixture's
    // `params` has no `year` field, so swapping the `year` argument for
    // `params.year` at the rangeFor call site would silently fall to the
    // pre-2026 25% rate and render $1,000,000 - $1,560,800 instead — this
    // assertion is what turns red under that mutation (R8).
    expect(rows.find((r) => r.id === "amtExemption")!.thresholdDisplay).toBe("$1,000,000 - $1,280,400");

    // Charitable limit: 60% of the scenario's AGI, computed by hand here (not
    // by calling rangeFor/the code under test) — 0.6 * 300,000 = 180,000. It
    // lives on the PER-SIDE field, not in the shared column, because the two
    // sides have their own AGI (see the [C3] tests below).
    expect(rows.find((r) => r.id === "charitableLimit")!.alternativeThresholdDisplay).toBe("$180,000");

    // NA range (AOTC is statutorily denied to MFS filers — IRC 25A(g)(6)).
    const mfsRows = buildThresholdReport({
      year: 2026, scenario: py(facts()), base: undefined, params,
      household: { ...household, filingStatus: "married_separate" },
    });
    expect(mfsRows.find((r) => r.id === "aotc")!.thresholdDisplay).toBe("—");
  });

  it("[R10.6 / R5] statuses each side against its OWN household's CTC range, never the report's household argument", () => {
    // Scenario: 1 qualifying child -> CTC range [400,000, 444,000].
    const scenarioHousehold: ThresholdHousehold = { ...household, qualifyingChildren: 1, otherDependents: 0 };
    // Base: 2 qualifying children -> CTC range [400,000, 488,000]. The range
    // START is identical either way (400,000) — only the END moves with
    // child count, so magiForCredits below is deliberately placed between
    // the two ends (444,000 and 488,000), where the two households disagree.
    const baseHousehold: ThresholdHousehold = { ...household, qualifyingChildren: 2, otherDependents: 0 };

    const scenario = py(facts({ household: scenarioHousehold, magiForCredits: 500000 })); // >= 444,000 -> "out"
    const base = py(facts({ household: baseHousehold, magiForCredits: 460000 }));          // in [400k,488k) -> "partial"

    const rows = buildThresholdReport({
      year: 2026, scenario, base, params,
      household: scenarioHousehold, // the report's shared household arg mirrors the scenario's
    });

    const ctc = rows.find((r) => r.id === "ctc")!;
    expect(ctc.alternativeStatus).toBe("out");
    expect(ctc.originalStatus).toBe("partial");
    expect(ctc.alternativeStatus).not.toBe(ctc.originalStatus);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // [C3] charitableLimit's 60%-of-AGI ceiling is a PER-SIDE figure. Both sides
  // share one Threshold column but have their OWN AGI, so a single cell there
  // could only ever describe one of them — it silently reported the
  // Alternative's ceiling under a header that reads as shared. The rule ("60%
  // of AGI") is what is genuinely shared; the two dollar ceilings move into
  // the two per-side columns, whose status cells carry no signal for this row
  // (statusFor("charitableLimit") returns "full" unconditionally,
  // thresholds.ts:260).
  // ══════════════════════════════════════════════════════════════════════════

  it("[C3] gives charitableLimit a per-side dollar ceiling and puts the RULE in the shared column", () => {
    // Two DIFFERENT AGIs, so swapping the two per-side fields reddens this —
    // a fixture where both sides earned the same would be blind to the swap.
    const rows = buildThresholdReport({
      year: 2026,
      scenario: py(facts({ agi: 800000 })),
      base: py(facts({ agi: 300000 })),
      params, household,
    });
    const charitable = rows.find((r) => r.id === "charitableLimit")!;

    // Hand-computed, NOT via rangeFor/the code under test: 0.6 * 800,000 =
    // 480,000 and 0.6 * 300,000 = 180,000. One toEqual = one throw point, so
    // no assertion here can be masked by an earlier one failing first.
    expect({
      alternative: charitable.alternativeThresholdDisplay,
      original: charitable.originalThresholdDisplay,
      shared: charitable.thresholdDisplay,
    }).toEqual({
      alternative: "$480,000",
      original: "$180,000",
      shared: "60% of AGI",
    });
  });

  it("[Ruling 4] shows the em-dash rather than a negative ceiling when a side's AGI is <= 0", () => {
    // A negative AGI is CORRECT and load-bearing in the engine (a big loss
    // year) — this is a DISPLAY decision only, and nothing here clamps the
    // engine. "60% of negative" is not a charitable ceiling an advisor can
    // act on, so neither side may print "$-180,000".
    //
    // -300,000 pins the strictly-negative case and 0 pins the BOUNDARY: a
    // `< 0` guard would leave the base side rendering "$0", which reads as a
    // real (and wrong) ceiling of zero.
    const rows = buildThresholdReport({
      year: 2026,
      scenario: py(facts({ agi: -300000 })),
      base: py(facts({ agi: 0 })),
      params, household,
    });
    const charitable = rows.find((r) => r.id === "charitableLimit")!;

    expect({
      alternative: charitable.alternativeThresholdDisplay,
      original: charitable.originalThresholdDisplay,
      shared: charitable.thresholdDisplay,
    }).toEqual({
      alternative: "—",
      original: "—",
      // The rule still applies — only the arithmetic is unshowable.
      shared: "60% of AGI",
    });
  });

  it("[C3] em-dashes only the side whose facts are absent, leaving the other side's ceiling", () => {
    // Both directions in ONE toEqual: two throw-point-sharing halves that are
    // mirror images, so a fix that em-dashes BOTH sides whenever EITHER side
    // is missing — or that reads the wrong side's facts — reddens.
    const withFacts = py(facts({ agi: 300000 }));
    const flat = { year: 2026 } as ProjectionYear; // no thresholdFacts

    const noBase = buildThresholdReport({
      year: 2026, scenario: withFacts, base: undefined, params, household,
    }).find((r) => r.id === "charitableLimit")!;

    const flatScenario = buildThresholdReport({
      year: 2026, scenario: flat, base: withFacts, params, household,
    }).find((r) => r.id === "charitableLimit")!;

    expect({
      noBase: {
        alternative: noBase.alternativeThresholdDisplay,
        original: noBase.originalThresholdDisplay,
      },
      flatScenario: {
        alternative: flatScenario.alternativeThresholdDisplay,
        original: flatScenario.originalThresholdDisplay,
      },
    }).toEqual({
      noBase: { alternative: "$180,000", original: "—" },
      flatScenario: { alternative: "—", original: "$180,000" },
    });
  });
});
