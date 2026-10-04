import type { ClientData, PlanSettings, StressTestKind, StressTestParams } from "./types";

/** One fixed change id per stressor kind. A scenario holds at most one of each
 *  (the engine has one slot per kind), so a re-save upserts the same
 *  `scenario_changes` row through its (scenario, kind, target, op) unique index.
 *  Unique per scenario only — two scenarios' market crashes share an id. */
export const STRESS_TEST_IDS: Record<StressTestKind, string> = {
  inflation: "085ab2d3-98e3-46ce-8c57-9e27ec49e040",
  "ss-haircut": "f8f88880-f862-4bf3-b643-852f4d627b8e",
  "tax-rates": "30113bd3-d721-4be5-9553-aa8e7ac508b7",
  disability: "b9002e7c-b616-45c0-a401-3b02773abf81",
  "market-crash": "f06746bf-25ea-4c3f-9430-c3c7edf1b100",
  "exemption-cap": "941b73cd-110a-4d13-bca5-8fba8d84bb83",
};

/** The plan-settings field each stressor writes — exactly what `withStressTest`
 *  sets (pinned by its test). */
export const STRESS_TEST_FIELD = {
  inflation: "livingExpenseInflationOverride",
  "ss-haircut": "ssBenefitHaircut",
  "tax-rates": "taxRateStress",
  disability: "disabilityEvent",
  "market-crash": "marketShock",
  "exemption-cap": "lifetimeExemptionCap",
} as const satisfies Record<StressTestKind, keyof PlanSettings>;

/** Writes one stressor onto plan settings. The scenario overlay and the
 *  Solver's draft mutations both go through here, so a saved stressor and a
 *  draft one cannot write a field two different ways. */
export function withStressTest(ps: PlanSettings, t: StressTestParams): PlanSettings {
  switch (t.kind) {
    case "inflation":
      // Living expenses only — deliberately not `inflationRate`, which also
      // drives tax indexing, incomes and savings.
      return { ...ps, livingExpenseInflationOverride: t.rate };
    case "ss-haircut":
      return { ...ps, ssBenefitHaircut: { pct: t.pct, startYear: t.startYear } };
    case "tax-rates":
      return { ...ps, taxRateStress: { points: t.points, startYear: t.startYear } };
    case "disability":
      return { ...ps, disabilityEvent: { person: t.person, startYear: t.startYear, endYear: t.endYear } };
    case "market-crash":
      return { ...ps, marketShock: { year: t.year, drawdownPct: t.drawdownPct } };
    case "exemption-cap":
      return { ...ps, lifetimeExemptionCap: t.cap };
  }
}

/** Folds the scenario's saved stressors into plan settings. `applyScenarioChanges`
 *  runs it after every other change, so a saved stressor wins over a legacy
 *  combined `plan_settings` edit that set the same field, whatever its order. */
export function applyStressTests(tree: ClientData): void {
  for (const t of tree.stressTests ?? []) {
    tree.planSettings = withStressTest(tree.planSettings, t);
  }
}
