import { describe, expect, it } from "vitest";
import { RISK_LEVELS } from "@/lib/risk-levels";
import { planningDecisionsSchema } from "../types";
import { PLANNER_SYSTEM_PROMPT } from "../prompt";

const MINIMAL = { version: 1, assumptions: {}, savings: [], socialSecurity: [], goals: [], incomeTiming: [], questions: [], notes: [] };

/** A decision wrapper around `value`, with the required evidence fields. */
function d(value: unknown) {
  return { value, provenance: "document", reason: "Stated in the document." };
}

describe("planningDecisionsSchema", () => {
  it("accepts a minimal well-formed payload", () => {
    expect(planningDecisionsSchema.safeParse(MINIMAL).success).toBe(true);
  });

  it("requires a reason on every decision", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { retirementAge: { value: 64, provenance: "document" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a provenance outside the vocabulary", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { retirementAge: { value: 64, provenance: "vibes", reason: "x" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts the estimated provenance", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { retirementAge: { value: 64, provenance: "estimated", reason: "Model estimate." } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown root key", () => {
    expect(planningDecisionsSchema.safeParse({ ...MINIMAL, mystery: 1 }).success).toBe(false);
  });

  it("caps oversize lists", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      savings: Array.from({ length: 201 }, () => ({ accountName: "a", owner: "client" })),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a year ref outside YEAR_REFS", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      incomeTiming: [{ incomeName: "Salary", endYearRef: { value: "someday", provenance: "document", reason: "x" } }],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a year ref inside YEAR_REFS", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      incomeTiming: [{ incomeName: "Salary", endYearRef: { value: "client_retirement", provenance: "document", reason: "x" } }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an advisor/system provenance the planner may not claim", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { retirementAge: { value: 64, provenance: "stated", reason: "x" } },
    });
    expect(parsed.success).toBe(false);
  });
});

// R5 (whole-branch review, I3). `riskTolerance` was a bare `z.string()`, so a
// model emitting "Moderate" or "balanced" passed the schema and was then
// dropped in total silence by `commit/goals.ts`'s `isRiskLevel` gate. Typing it
// as the real enum means `propose_decisions` hands the model the valid set on
// rejection (tools.ts), and the prompt now names the five values up front.
describe("planningDecisionsSchema — riskTolerance is the RiskLevel enum (R5)", () => {
  it.each(RISK_LEVELS)("accepts the real rung %s", (level) => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { riskTolerance: d(level) },
    });
    expect(parsed.success).toBe(true);
  });

  it.each(["Moderate", "balanced", "moderate_conservative", "moderate_aggressive", "growth"])(
    "rejects the near-miss %s",
    (bad) => {
      const parsed = planningDecisionsSchema.safeParse({
        ...MINIMAL,
        assumptions: { riskTolerance: d(bad) },
      });
      expect(parsed.success).toBe(false);
    },
  );
});

describe("PLANNER_SYSTEM_PROMPT teaches the risk vocabulary (R5)", () => {
  it.each(RISK_LEVELS)("names %s", (level) => {
    expect(PLANNER_SYSTEM_PROMPT).toContain(level);
  });

  it("does not name the two invalid tokens the extraction prompt used to teach", () => {
    // `moderate_conservative` / `moderate_aggressive` are NOT `RiskLevel`
    // values. Matched with a word boundary so `moderately_conservative` — which
    // contains neither as a substring anyway — cannot mask a real regression.
    expect(PLANNER_SYSTEM_PROMPT).not.toMatch(/\bmoderate_conservative\b/);
    expect(PLANNER_SYSTEM_PROMPT).not.toMatch(/\bmoderate_aggressive\b/);
  });
});

// R6 (whole-branch review, I5). Every numeric field shared one bare
// `decision(z.number())`. `savings_rules.employer_match_pct` is decimal(5,4) —
// max 9.9999 — so `50` meaning 50% raised a Postgres numeric-overflow that
// failed the whole commit transaction, while `4` fitted and silently committed
// a 400% match. Each bound is asserted at BOTH ends: a bound that only rejects
// is as wrong as no bound, since it would reject legitimate values.
describe("planningDecisionsSchema — numeric bounds (R6)", () => {
  function savingsRow(field: string, value: number) {
    return {
      ...MINIMAL,
      savings: [{ accountName: "Zach 401(k)", owner: "client", [field]: d(value) }],
    };
  }

  it.each(["annualPercent", "employerMatchPct", "employerMatchCap", "rothPercent"])(
    "%s accepts a fraction",
    (field) => {
      expect(planningDecisionsSchema.safeParse(savingsRow(field, 0.1)).success).toBe(true);
      expect(planningDecisionsSchema.safeParse(savingsRow(field, 1)).success).toBe(true);
      expect(planningDecisionsSchema.safeParse(savingsRow(field, 0)).success).toBe(true);
    },
  );

  it.each(["annualPercent", "employerMatchPct", "employerMatchCap", "rothPercent"])(
    "%s rejects a whole percent and a negative",
    (field) => {
      // 50 meaning 50%, and 4 meaning 4% — the value that used to FIT
      // decimal(5,4) and commit a 400% match without a word.
      expect(planningDecisionsSchema.safeParse(savingsRow(field, 50)).success).toBe(false);
      expect(planningDecisionsSchema.safeParse(savingsRow(field, 4)).success).toBe(false);
      expect(planningDecisionsSchema.safeParse(savingsRow(field, -0.1)).success).toBe(false);
    },
  );

  it("savings annualAmount accepts dollars and rejects a negative", () => {
    expect(planningDecisionsSchema.safeParse(savingsRow("annualAmount", 23_500)).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(savingsRow("annualAmount", -1)).success).toBe(false);
  });

  function assumption(field: string, value: number) {
    return { ...MINIMAL, assumptions: { [field]: d(value) } };
  }

  it.each(["retirementAge", "spouseRetirementAge"])("%s accepts a plausible age", (field) => {
    expect(planningDecisionsSchema.safeParse(assumption(field, 64)).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(assumption(field, 30)).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(assumption(field, 90)).success).toBe(true);
  });

  it.each(["retirementAge", "spouseRetirementAge"])("%s rejects an implausible age", (field) => {
    expect(planningDecisionsSchema.safeParse(assumption(field, 6)).success).toBe(false);
    expect(planningDecisionsSchema.safeParse(assumption(field, 640)).success).toBe(false);
  });

  it.each(["lifeExpectancy", "spouseLifeExpectancy"])("%s accepts 60..120 and rejects outside", (field) => {
    expect(planningDecisionsSchema.safeParse(assumption(field, 92)).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(assumption(field, 60)).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(assumption(field, 120)).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(assumption(field, 45)).success).toBe(false);
    expect(planningDecisionsSchema.safeParse(assumption(field, 150)).success).toBe(false);
  });

  it("inflationRate accepts a decimal and rejects a whole percent", () => {
    expect(planningDecisionsSchema.safeParse(assumption("inflationRate", 0.03)).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(assumption("inflationRate", 3)).success).toBe(false);
  });

  it.each(["currentLivingSpending", "retirementLivingSpending"])(
    "%s accepts annual dollars and rejects a negative",
    (field) => {
      expect(planningDecisionsSchema.safeParse(assumption(field, 180_000)).success).toBe(true);
      expect(planningDecisionsSchema.safeParse(assumption(field, -5)).success).toBe(false);
    },
  );

  function ssRow(patch: Record<string, unknown>) {
    return {
      ...MINIMAL,
      socialSecurity: [{
        owner: "client",
        basis: "stated_fra_amount",
        piaMonthly: d(3200),
        claimingAge: d(67),
        ...patch,
      }],
    };
  }

  it("piaMonthly accepts a monthly figure and rejects an annual one", () => {
    expect(planningDecisionsSchema.safeParse(ssRow({})).success).toBe(true);
    // 38,400 = 3200 * 12 — an annual benefit written into the monthly field.
    expect(planningDecisionsSchema.safeParse(ssRow({ piaMonthly: d(38_400) })).success).toBe(false);
    expect(planningDecisionsSchema.safeParse(ssRow({ piaMonthly: d(-1) })).success).toBe(false);
  });

  it("claimingAge accepts the statutory 62..70 window and rejects outside it", () => {
    expect(planningDecisionsSchema.safeParse(ssRow({ claimingAge: d(62) })).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(ssRow({ claimingAge: d(70) })).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(ssRow({ claimingAge: d(61) })).success).toBe(false);
    expect(planningDecisionsSchema.safeParse(ssRow({ claimingAge: d(71) })).success).toBe(false);
  });

  function goalRow(patch: Record<string, unknown>) {
    return {
      ...MINIMAL,
      goals: [{
        kind: "education",
        name: d("Ava college"),
        annualAmount: d(30_000),
        startYear: d(2035),
        endYear: d(2038),
        dedicatedAccountNames: [],
        ...patch,
      }],
    };
  }

  it("goal years accept a calendar year and reject a duration mistaken for one", () => {
    expect(planningDecisionsSchema.safeParse(goalRow({})).success).toBe(true);
    // `4` is the "Ends: After 4 Years" duration, not a calendar year.
    expect(planningDecisionsSchema.safeParse(goalRow({ endYear: d(4) })).success).toBe(false);
  });

  it("goal growthRate accepts a fraction and rejects a whole percent", () => {
    expect(planningDecisionsSchema.safeParse(goalRow({ growthRate: d(0.05) })).success).toBe(true);
    expect(planningDecisionsSchema.safeParse(goalRow({ growthRate: d(5) })).success).toBe(false);
  });
});
