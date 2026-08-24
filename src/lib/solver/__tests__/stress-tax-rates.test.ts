import { describe, it, expect } from "vitest";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { MAX_RATE_STRESS_POINTS } from "@/lib/tax/rate-stress";
import { applyMutations } from "../apply-mutations";
import { mutationKey, type SolverMutation } from "../types";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";
import { isBaseSavableMutation } from "../mutations-to-base-updates";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";

const M: SolverMutation = { kind: "stress-tax-rates", points: 0.03, startYear: 2030 };

/** Rejection issues, so a bounds test can prove WHICH bound rejected — a
 *  discriminator miss and a `.max()` miss both "throw", and only the issue
 *  code and path tell them apart. */
function rejectionIssues(input: unknown) {
  const parsed = SOLVER_MUTATION_SCHEMA.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.success ? [] : parsed.error.issues;
}

describe("stress-tax-rates mutation", () => {
  it("parses through the schema", () => {
    expect(SOLVER_MUTATION_SCHEMA.parse(M)).toEqual(M);
  });

  it("rejects points above the ceiling, from the .max() bound itself", () => {
    const issues = rejectionIssues({ ...M, points: MAX_RATE_STRESS_POINTS + 0.01 });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "too_big", path: ["points"] }),
    );
  });

  it("ACCEPTS the ceiling itself — the bounds are inclusive", () => {
    // The single most likely value to arrive from the UI: the row clamps with
    // `Math.min(points, MAX_RATE_STRESS_POINTS)`, so anything typed above the
    // ceiling is committed as EXACTLY the ceiling. A `.lt()` where the schema
    // means `.max()` would reject the dial's own top setting while both
    // rejection tests above stayed green.
    expect(SOLVER_MUTATION_SCHEMA.parse({ ...M, points: MAX_RATE_STRESS_POINTS }))
      .toEqual({ ...M, points: MAX_RATE_STRESS_POINTS });
  });

  it("ACCEPTS zero points — the floor is inclusive too", () => {
    expect(SOLVER_MUTATION_SCHEMA.parse({ ...M, points: 0 })).toEqual({ ...M, points: 0 });
  });

  it("rejects a negative points value, from the .min() bound itself", () => {
    const issues = rejectionIssues({ ...M, points: -0.01 });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "too_small", path: ["points"] }),
    );
  });

  it("puts startYear through the shared YEAR guard", () => {
    // An unvalidated startYear makes `year < NaN` false in the engine, which
    // applies the stressor in EVERY year, retroactively. A bare z.number()
    // would still reject NaN in zod 4 — only YEAR's range rejects 1800.
    expect(rejectionIssues({ ...M, startYear: 1800 })).toContainEqual(
      expect.objectContaining({ path: ["startYear"] }),
    );
    expect(rejectionIssues({ ...M, startYear: Number.NaN })).toContainEqual(
      expect.objectContaining({ path: ["startYear"] }),
    );
  });

  it("has a stable singleton key", () => {
    expect(mutationKey(M)).toBe("stress-tax-rates");
  });

  it("writes planSettings.taxRateStress", () => {
    const out = applyMutations(buildClientData(), [M]);
    expect(out.planSettings.taxRateStress).toEqual({ points: 0.03, startYear: 2030 });
  });

  it("leaves planSettings.taxRateStress absent when not applied", () => {
    // Vacuity guard for the test above: proves the fixture does not arrive
    // already carrying the field. No change to this feature's code reds it.
    expect(applyMutations(buildClientData(), []).planSettings.taxRateStress).toBeUndefined();
  });

  it("is not base-savable", () => {
    // Stress settings live only in scenario_changes — there is no plan_settings
    // column for them, and reporting savable would make Save-to-base drop them
    // AND clear them from the working set.
    expect(isBaseSavableMutation(M)).toBe(false);
  });

  it("round-trips into a scenario change", () => {
    const source = buildClientData();
    const drafts = mutationsToScenarioChanges(source, CLIENT_ID, [M]);
    const ps = drafts.filter((d) => d.targetKind === "plan_settings");
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ opType: "edit", targetId: "plan_settings" });
    expect(ps[0].payload).toEqual({
      taxRateStress: { from: null, to: { points: 0.03, startYear: 2030 } },
    });
  });

  it("carries the existing stressor as `from` when one is already set", () => {
    const source = buildClientData();
    source.planSettings = {
      ...source.planSettings,
      taxRateStress: { points: 0.01, startYear: 2028 },
    };
    const drafts = mutationsToScenarioChanges(source, CLIENT_ID, [M]);
    const ps = drafts.filter((d) => d.targetKind === "plan_settings");
    expect(ps[0].payload).toEqual({
      taxRateStress: {
        from: { points: 0.01, startYear: 2028 },
        to: { points: 0.03, startYear: 2030 },
      },
    });
  });
});
