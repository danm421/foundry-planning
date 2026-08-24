import { z } from "zod";
import { strictPartial } from "@/lib/schemas/strict-partial";

/**
 * Disability policy request shapes.
 *
 * Client-level, not scenario-scoped — a disability policy belongs to the
 * person, the same way life insurance belongs to the client.
 *
 * ⚠️ A `null` monthly max means UNCAPPED. Every max field here is
 * `.nullable()`, never `.default(0)` — coercing null → 0 anywhere along the
 * chain (schema, route, mapper) turns an uncapped benefit into one that pays
 * nothing, and does it silently.
 */
const base = {
  name: z.string().trim().min(1).max(200),
  insured: z.enum(["client", "spouse"]),
  carrier: z.string().trim().max(200).nullable().optional(),

  coveredEarningsMode: z.enum(["salary", "manual"]).default("salary"),
  coveredEarningsAmount: z.number().gte(0).nullable().optional(),

  hasShortTerm: z.boolean().default(true),
  stdEliminationDays: z.number().int().gte(0).lte(730).default(7),
  stdBenefitPct: z.number().gte(0).lte(1).default(0.6),
  stdDurationWeeks: z.number().int().positive().lte(520).default(13),
  stdMonthlyMax: z.number().gte(0).nullable().optional(),

  hasLongTerm: z.boolean().default(true),
  ltdEliminationDays: z.number().int().gte(0).lte(730).default(90),
  ltdBenefitPct: z.number().gte(0).lte(1).default(0.6),
  ltdMonthlyMax: z.number().gte(0).nullable().optional(),
  ltdBenefitPeriodMode: z
    .enum(["to_age", "to_ssnra", "years", "lifetime"])
    .default("to_age"),
  ltdBenefitPeriodAge: z.number().int().gte(40).lte(100).nullable().optional(),
  ltdBenefitPeriodYears: z.number().int().positive().lte(60).nullable().optional(),

  benefitTaxable: z.boolean().default(true),
  colaRate: z.number().gte(0).lte(0.2).default(0),
  annualPremium: z.number().gte(0).default(0),
  premiumPayer: z.enum(["employer", "insured"]).default("employer"),
  notes: z.string().trim().max(2000).nullable().optional(),
};

function validateCrossFields(
  d: Partial<{
    hasShortTerm: boolean;
    hasLongTerm: boolean;
    coveredEarningsMode: string;
    coveredEarningsAmount: number | null;
    ltdBenefitPeriodMode: string;
    ltdBenefitPeriodAge: number | null;
    ltdBenefitPeriodYears: number | null;
    stdDurationWeeks: number;
    stdEliminationDays: number;
  }>,
  ctx: z.RefinementCtx,
): void {
  if (d.hasShortTerm === false && d.hasLongTerm === false) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A policy must cover short-term, long-term, or both",
      path: ["hasLongTerm"],
    });
  }
  if (d.coveredEarningsMode === "manual" && d.coveredEarningsAmount == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Manual covered earnings require an amount",
      path: ["coveredEarningsAmount"],
    });
  }
  if (d.hasLongTerm !== false) {
    if (d.ltdBenefitPeriodMode === "to_age" && d.ltdBenefitPeriodAge == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A to-age benefit period requires an age",
        path: ["ltdBenefitPeriodAge"],
      });
    }
    if (d.ltdBenefitPeriodMode === "years" && d.ltdBenefitPeriodYears == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A fixed benefit period requires a number of years",
        path: ["ltdBenefitPeriodYears"],
      });
    }
  }
  // Duration is measured from the date of disability, so a duration at or
  // below the elimination period pays nothing at all.
  if (
    d.hasShortTerm !== false &&
    d.stdDurationWeeks != null &&
    d.stdEliminationDays != null &&
    d.stdDurationWeeks * 7 <= d.stdEliminationDays
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Short-term duration must be longer than the waiting period",
      path: ["stdDurationWeeks"],
    });
  }
}

export const disabilityPolicyCreateSchema = z
  .object(base)
  .superRefine(validateCrossFields);

/**
 * `strictPartial`, not `.partial()`. In Zod 4 `.optional()` WRAPS a
 * `ZodDefault` instead of removing it, so on a plain `.partial()` every
 * default would fire for an absent key — and the PATCH route writes any key
 * that is `!== undefined`. A one-field PATCH would silently reset the STD/LTD
 * percentages, elimination periods and benefit period back to "typical".
 * The create schema deliberately keeps its defaults; a create body is complete.
 */
export const disabilityPolicyUpdateSchema = strictPartial(
  z.object(base),
).superRefine(validateCrossFields);

export type DisabilityPolicyCreateInput = z.infer<
  typeof disabilityPolicyCreateSchema
>;
export type DisabilityPolicyUpdateInput = z.infer<
  typeof disabilityPolicyUpdateSchema
>;

/** The one-click workplace package. Kept beside the schema so the API and the
 *  UI cannot drift apart on what "typical" means.
 *  `stdMonthlyMax: null` is deliberate — group STD is usually uncapped, and a
 *  null here must stay null all the way to the column. */
export const WORKPLACE_DEFAULTS = {
  name: "Group disability",
  coveredEarningsMode: "salary",
  hasShortTerm: true,
  stdEliminationDays: 7,
  stdBenefitPct: 0.6,
  stdDurationWeeks: 13,
  stdMonthlyMax: null,
  hasLongTerm: true,
  ltdEliminationDays: 90,
  ltdBenefitPct: 0.6,
  ltdMonthlyMax: 10_000,
  ltdBenefitPeriodMode: "to_age",
  ltdBenefitPeriodAge: 65,
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer",
} as const;
