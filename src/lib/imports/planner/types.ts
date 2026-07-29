import { z } from "zod";
import { YEAR_REFS } from "@/lib/milestones";

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

const numberDecision = decision(z.number());
const stringDecision = decision(z.string());

export const planningDecisionsSchema = z
  .object({
    version: z.literal(1),
    assumptions: z
      .object({
        retirementAge: numberDecision.optional(),
        spouseRetirementAge: numberDecision.optional(),
        lifeExpectancy: numberDecision.optional(),
        spouseLifeExpectancy: numberDecision.optional(),
        inflationRate: numberDecision.optional(),
        riskTolerance: stringDecision.optional(),
        currentLivingSpending: numberDecision.optional(),
        retirementLivingSpending: numberDecision.optional(),
      })
      .strict(),
    savings: z
      .array(
        z
          .object({
            accountName: z.string().min(1),
            owner: z.enum(["client", "spouse"]),
            annualPercent: numberDecision.optional(),
            annualAmount: numberDecision.optional(),
            employerMatchPct: numberDecision.optional(),
            employerMatchCap: numberDecision.optional(),
            rothPercent: numberDecision.optional(),
          })
          .strict(),
      )
      .max(200),
    socialSecurity: z
      .array(
        z
          .object({
            owner: z.enum(["client", "spouse"]),
            piaMonthly: numberDecision,
            claimingAge: numberDecision,
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
            annualAmount: numberDecision,
            startYear: numberDecision,
            endYear: numberDecision,
            growthRate: numberDecision.optional(),
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
