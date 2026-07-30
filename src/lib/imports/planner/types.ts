import { z } from "zod";
import { YEAR_REFS } from "@/lib/milestones";
import { RISK_LEVELS } from "@/lib/risk-levels";

/**
 * The planner's output contract. The planner (Task 13's bounded tool loop)
 * proposes changes to the fact-finder draft as a `PlanningDecisions` payload;
 * `applyDecisions` (Task 14) is the only consumer that turns it into writes.
 *
 * Every decision carries its evidence: `provenance` says where the value
 * came from, `reason` says why (REQUIRED - a value with no stated basis is
 * exactly the thing this feature exists to eliminate).
 *
 * `provenance` is the full vocabulary minus the three the planner may not
 * claim (`stated`, `client_record`, `build_request` are advisor/system
 * provenances, not planner outputs).
 */
const provenance = z.enum(["document", "derived", "estimated"]);

function decision<T extends z.ZodTypeAny>(value: T) {
  return z
    .object({
      value,
      provenance,
      reason: z.string().min(1),
      sourceQuote: z.string().max(500).optional(),
    })
    .strict();
}

// ── Bounded numeric decisions (R6) ──────────────────────────────────────────
//
// Every numeric field used to share one bare `decision(z.number())`, which let
// the model's single most likely mistake through unchecked: emitting a percent
// as `50` where the column wants the fraction `0.5`.
// `savings_rules.employer_match_pct` is `decimal(5,4)` (schema.ts) — max
// 9.9999 — so `50` raises a Postgres numeric-overflow that fails the WHOLE
// commit transaction, while `4` fits and silently commits a 400% employer
// match. Bounding at the schema rejects the value where `propose_decisions`
// can still hand the model the reason and let it correct itself (tools.ts),
// rather than at Postgres or not at all.
//
// Each bound below cites the column precision or the human range it comes
// from; none is invented.

/**
 * A retirement age. Same bound as the two other LLM-facing schemas that write
 * the same `clients` columns (`extraction/identify-household.ts`,
 * `forge/tools/global-actions.ts`) — one vocabulary for one field.
 */
const ageDecision = decision(z.number().int().min(30).max(90));

/** A life expectancy. Same precedent as `ageDecision` above. */
const lifeExpectancyDecision = decision(z.number().int().min(60).max(120));

/**
 * A Social Security claim age. 62 is the statutory earliest retirement-benefit
 * claim and delayed credits stop accruing at 70, so a value outside that is a
 * document- or reading-error the planner is already asked to flag rather than
 * commit (see the prompt's "Data-entry errors" section).
 */
const claimingAgeDecision = decision(z.number().int().min(62).max(70));

/**
 * A rate the engine stores as a FRACTION of something:
 * `savings_rules.annual_percent` is decimal(6,4),
 * `employer_match_pct`/`employer_match_cap` decimal(5,4), `roth_percent`
 * decimal(8,6), `expenses.growth_rate` decimal(5,4). Every one of those either
 * overflows or silently misreads on a whole-percent value, and none has a
 * legitimate value above 1.0 — a 100% deferral, or a dollar-for-dollar match,
 * is the ceiling.
 */
const fractionDecision = decision(z.number().min(0).max(1));

/**
 * A plan-level inflation assumption as a decimal. 0.2 is already far above any
 * real plan-level assumption, so this is the bound that catches `3` meaning 3%.
 */
const inflationDecision = decision(z.number().min(0).max(0.2));

/**
 * An annual dollar amount. The columns these reach — `expenses.annual_amount`
 * and `savings_rules.annual_amount` — are decimal(15,2), so the ceiling is a
 * domain sanity limit rather than a column limit. Non-negative: none of these
 * fields models a refund.
 */
const dollarsDecision = decision(z.number().min(0).max(100_000_000));

/**
 * A MONTHLY Social Security PIA at full retirement age (`incomes.pia_monthly`,
 * decimal(15,2)). The SSA maximum PIA is roughly $4,100/mo in 2026, so 20,000
 * is a wide sanity ceiling that still catches an ANNUAL benefit written into a
 * monthly field.
 */
const piaMonthlyDecision = decision(z.number().min(0).max(20_000));

/**
 * A calendar year. Same bound as `@/lib/schemas/common`'s shared `year`,
 * inlined rather than imported so this module stays free of that file's
 * `next/server` dependency.
 */
const yearDecision = decision(z.number().int().min(1900).max(2200));

const stringDecision = decision(z.string());

/**
 * The household's risk tolerance. A bare `z.string()` here was silently
 * discarded downstream: `commit/goals.ts` gates the write on
 * `isRiskLevel(tolerance)`, so a model emitting "Moderate" or "balanced" wrote
 * nothing and said nothing. Typing it as the real enum means the model is told
 * the vocabulary on rejection instead.
 */
const riskToleranceDecision = decision(z.enum(RISK_LEVELS));

export const planningDecisionsSchema = z
  .object({
    version: z.literal(1),
    assumptions: z
      .object({
        retirementAge: ageDecision.optional(),
        spouseRetirementAge: ageDecision.optional(),
        lifeExpectancy: lifeExpectancyDecision.optional(),
        spouseLifeExpectancy: lifeExpectancyDecision.optional(),
        inflationRate: inflationDecision.optional(),
        riskTolerance: riskToleranceDecision.optional(),
        currentLivingSpending: dollarsDecision.optional(),
        retirementLivingSpending: dollarsDecision.optional(),
      })
      .strict(),
    savings: z
      .array(
        z
          .object({
            accountName: z.string().min(1),
            owner: z.enum(["client", "spouse"]),
            annualPercent: fractionDecision.optional(),
            annualAmount: dollarsDecision.optional(),
            employerMatchPct: fractionDecision.optional(),
            employerMatchCap: fractionDecision.optional(),
            rothPercent: fractionDecision.optional(),
          })
          .strict(),
      )
      .max(200),
    socialSecurity: z
      .array(
        z
          .object({
            owner: z.enum(["client", "spouse"]),
            piaMonthly: piaMonthlyDecision,
            claimingAge: claimingAgeDecision,
            basis: z.enum(["stated_fra_amount", "estimated_from_income"]),
          })
          .strict(),
      )
      .max(2),
    goals: z
      .array(
        z
          .object({
            kind: z.enum(["education", "one_time", "recurring"]),
            name: stringDecision,
            annualAmount: dollarsDecision,
            startYear: yearDecision,
            endYear: yearDecision,
            growthRate: fractionDecision.optional(),
            forFamilyMemberName: stringDecision.optional(),
            dedicatedAccountNames: z.array(z.string()).max(20).default([]),
          })
          .strict(),
      )
      .max(100),
    incomeTiming: z
      .array(
        z
          .object({
            incomeName: z.string().min(1),
            endYearRef: decision(z.enum(YEAR_REFS)),
          })
          .strict(),
      )
      .max(100),
    questions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            field: z.string().min(1),
            prompt: z.string().min(1),
            options: z.array(z.string()).max(10).optional(),
          })
          .strict(),
      )
      .max(30),
    notes: z.array(z.string().max(500)).max(50),
  })
  .strict();

export type PlanningDecisions = z.infer<typeof planningDecisionsSchema>;

export type Decision<T> = { value: T; provenance: "document" | "derived" | "estimated"; reason: string; sourceQuote?: string };
export type SavingsDecision = PlanningDecisions["savings"][number];
export type SsDecision = PlanningDecisions["socialSecurity"][number];
export type GoalDecision = PlanningDecisions["goals"][number];
export type IncomeTimingOverride = PlanningDecisions["incomeTiming"][number];
export type PlannerQuestion = PlanningDecisions["questions"][number];
