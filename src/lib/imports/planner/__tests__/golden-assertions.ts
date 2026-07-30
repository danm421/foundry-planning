// Pure comparison logic for the golden-fixture eval (golden.eval.ts).
//
// Deliberately has NO I/O and calls no model - it only compares an already
// materialised `PlanningDecisions` against one `FixtureCase["expect"]` block.
// That split is what makes `golden-assertions.test.ts` able to exercise the
// manifest -> assertion mapping honestly under `npm test`, against hand-built
// objects, without ever touching Azure. golden.eval.ts is the only caller that
// feeds it a REAL planner result.
import type { PlanningDecisions } from "../types";
import type { FixtureCase } from "./fixtures/manifest";

export interface AssertionFailure {
  /** Dotted path identifying what was checked, e.g. "assumptions.retirementAge". */
  field: string;
  expected: unknown;
  actual: unknown;
}

const NUMBER_EPSILON = 1e-9;

function numbersEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < NUMBER_EPSILON;
}

/** Every `reason` string across the whole decisions payload, for `reasonContains`. */
function collectAllReasons(decisions: PlanningDecisions): string[] {
  const reasons: string[] = [];
  for (const v of Object.values(decisions.assumptions)) {
    if (v) reasons.push(v.reason);
  }
  for (const s of decisions.savings) {
    for (const key of ["annualPercent", "annualAmount", "employerMatchPct", "employerMatchCap", "rothPercent"] as const) {
      const d = s[key];
      if (d) reasons.push(d.reason);
    }
  }
  for (const ss of decisions.socialSecurity) {
    reasons.push(ss.piaMonthly.reason, ss.claimingAge.reason);
  }
  for (const g of decisions.goals) {
    reasons.push(g.name.reason, g.annualAmount.reason, g.startYear.reason, g.endYear.reason);
    if (g.growthRate) reasons.push(g.growthRate.reason);
    if (g.forFamilyMemberName) reasons.push(g.forFamilyMemberName.reason);
  }
  for (const t of decisions.incomeTiming) {
    reasons.push(t.endYearRef.reason);
  }
  return reasons;
}

/**
 * Compare a planner's `PlanningDecisions` against one fixture case's
 * expectations. Returns every mismatch found (empty array = the case passes).
 * Only fields present in `expect` are checked - an omitted manifest field
 * means "no assertion", not "assert absence". A field that IS present in
 * `expect` but missing from `decisions` is a failure (never treated as
 * `undefined === undefined` passing).
 */
export function checkFixtureCase(
  decisions: PlanningDecisions,
  expected: FixtureCase["expect"],
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];

  const checkAssumption = (
    field: "retirementAge" | "spouseRetirementAge" | "lifeExpectancy" | "spouseLifeExpectancy" | "inflationRate",
  ) => {
    const wanted = expected[field];
    if (wanted === undefined) return;
    const actual = decisions.assumptions[field]?.value;
    if (actual === undefined || !numbersEqual(actual, wanted)) {
      failures.push({ field: `assumptions.${field}`, expected: wanted, actual });
    }
  };
  checkAssumption("retirementAge");
  checkAssumption("spouseRetirementAge");
  checkAssumption("lifeExpectancy");
  checkAssumption("spouseLifeExpectancy");
  checkAssumption("inflationRate");

  if (expected.minSavings !== undefined && decisions.savings.length < expected.minSavings) {
    failures.push({
      field: "savings.length",
      expected: `>= ${expected.minSavings}`,
      actual: decisions.savings.length,
    });
  }

  if (expected.savingsPercentByAccount) {
    for (const [accountName, wantedPct] of Object.entries(expected.savingsPercentByAccount)) {
      const account = decisions.savings.find((s) => s.accountName === accountName);
      const actual = account?.annualPercent?.value;
      if (actual === undefined || !numbersEqual(actual, wantedPct)) {
        failures.push({
          field: `savings[accountName=${accountName}].annualPercent`,
          expected: wantedPct,
          actual,
        });
      }
    }
  }

  if (expected.savingsMatchByAccount) {
    for (const [accountName, [wantedPct, wantedCap]] of Object.entries(expected.savingsMatchByAccount)) {
      const account = decisions.savings.find((s) => s.accountName === accountName);
      const actualPct = account?.employerMatchPct?.value;
      const actualCap = account?.employerMatchCap?.value;
      if (actualPct === undefined || !numbersEqual(actualPct, wantedPct)) {
        failures.push({
          field: `savings[accountName=${accountName}].employerMatchPct`,
          expected: wantedPct,
          actual: actualPct,
        });
      }
      if (actualCap === undefined || !numbersEqual(actualCap, wantedCap)) {
        failures.push({
          field: `savings[accountName=${accountName}].employerMatchCap`,
          expected: wantedCap,
          actual: actualCap,
        });
      }
    }
  }

  if (expected.ssBasisByOwner) {
    for (const [owner, wantedBasis] of Object.entries(expected.ssBasisByOwner)) {
      const entry = decisions.socialSecurity.find((s) => s.owner === owner);
      if (!entry) {
        failures.push({ field: `socialSecurity[owner=${owner}]`, expected: wantedBasis, actual: undefined });
        continue;
      }
      if (entry.basis !== wantedBasis) {
        failures.push({
          field: `socialSecurity[owner=${owner}].basis`,
          expected: wantedBasis,
          actual: entry.basis,
        });
      }
      if (!entry.piaMonthly.value) {
        failures.push({
          field: `socialSecurity[owner=${owner}].piaMonthly`,
          expected: "non-zero",
          actual: entry.piaMonthly.value,
        });
      }
    }
  }

  if (expected.reasonContains) {
    const allReasons = collectAllReasons(decisions);
    for (const substring of expected.reasonContains) {
      if (!allReasons.some((r) => r.includes(substring))) {
        failures.push({ field: "reason", expected: `contains "${substring}"`, actual: allReasons });
      }
    }
  }

  if (expected.minGoals !== undefined && decisions.goals.length < expected.minGoals) {
    failures.push({
      field: "goals.length",
      expected: `>= ${expected.minGoals}`,
      actual: decisions.goals.length,
    });
  }

  return failures;
}

/** Render failures for a thrown Error message: fixture, field, expected, actual per line. */
export function formatFailures(slug: string, failures: AssertionFailure[]): string {
  return failures
    .map((f) => `  [${slug}] ${f.field}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`)
    .join("\n");
}
