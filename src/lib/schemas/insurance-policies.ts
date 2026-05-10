import { z } from "zod";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(uuidRegex, "Invalid UUID format");

const base = {
  name: z.string().trim().min(1).max(200),
  policyType: z.enum(["term", "whole", "universal", "variable"]),
  insuredPerson: z.enum(["client", "spouse", "joint"]),
  owner: z.enum(["client", "spouse", "joint"]),
  ownerEntityId: uuidSchema.nullable().optional(),
  faceValue: z.number().gte(0),
  cashValue: z.number().gte(0).optional().default(0),
  costBasis: z.number().gte(0).optional().default(0),
  premiumAmount: z.number().gte(0).optional().default(0),
  premiumYears: z.number().int().positive().nullable().optional(),
  termIssueYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
  termLengthYears: z.number().int().positive().nullable().optional(),
  endsAtInsuredRetirement: z.boolean().optional().default(false),
  cashValueGrowthMode: z.enum(["basic", "free_form"]).default("basic"),
  postPayoutGrowthRate: z.number().gte(0).lte(1).default(0.06),
  postPayoutModelPortfolioId: uuidSchema.nullable().optional(),
  cashValueSchedule: z.array(
    z.object({
      year: z.number().int().gte(1900).lte(2200),
      cashValue: z.number().gte(0),
    }),
  ).optional().default([]),
};

function validateTermFields(
  d: Partial<{ policyType: string; termIssueYear: number | null;
    termLengthYears: number | null; endsAtInsuredRetirement: boolean }>,
  ctx: z.RefinementCtx,
): void {
  if (d.policyType !== "term") return;
  if (d.termIssueYear == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Term policies require termIssueYear",
      path: ["termIssueYear"],
    });
  }
  const hasLength = d.termLengthYears != null;
  const hasRetirement = d.endsAtInsuredRetirement === true;
  if (!hasLength && !hasRetirement) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Term policies require either termLengthYears or endsAtInsuredRetirement",
      path: ["termLengthYears"],
    });
  }
  if (hasLength && hasRetirement) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "termLengthYears and endsAtInsuredRetirement are mutually exclusive",
      path: ["endsAtInsuredRetirement"],
    });
  }
}

function validateFreeFormSchedule(
  d: Partial<{ cashValueGrowthMode: string;
    cashValueSchedule: { year: number; cashValue: number }[] }>,
  ctx: z.RefinementCtx,
): void {
  if (d.cashValueGrowthMode !== "free_form") return;
  if (!d.cashValueSchedule || d.cashValueSchedule.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Free-form mode requires at least one schedule row",
      path: ["cashValueSchedule"],
    });
  }
}

export const insurancePolicyCreateSchema = z.object(base).superRefine((d, ctx) => {
  validateTermFields(d, ctx);
  validateFreeFormSchedule(d, ctx);
});

export const insurancePolicyUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as Record<string, z.ZodTypeAny>,
  )
  .superRefine((d, ctx) => {
    validateTermFields(d as never, ctx);
    validateFreeFormSchedule(d as never, ctx);
  });

export type InsurancePolicyCreateInput = z.infer<typeof insurancePolicyCreateSchema>;
export type InsurancePolicyUpdateInput = z.infer<typeof insurancePolicyUpdateSchema>;
