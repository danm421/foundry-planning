import { z } from "zod";
import { year } from "./common";
import { YEAR_REFS } from "@/lib/milestones";

/**
 * Annuity contracts — 1:1 extension on an `annuity` account (mirrors
 * `annuityContracts` in `src/db/schema.ts`). This is a full-replacement PUT
 * body (an upsert), so it is shaped like a create schema and keeps its
 * defaults — there is no separate update schema.
 */

const PRODUCT_TYPES = [
  "spia",
  "dia",
  "myga",
  "fixed",
  "fixed_indexed",
  "variable",
  "qlac",
] as const;

const TAX_TREATMENTS = ["qualified", "non_qualified", "tax_free"] as const;

const INCOME_MODES = ["none", "rider", "annuitized"] as const;

const PAYOUT_STRUCTURES = [
  "single_life",
  "joint_survivor",
  "life_with_period_certain",
  "period_certain",
  "cash_refund",
] as const;

/**
 * Nullable money: "" / null / absent all mean "unknown", never 0.
 * `Number("") === 0`, and a 0 cost basis silently makes the whole contract
 * taxable — this is the same trap `survivorshipPctOptional` in
 * `lib/schemas/incomes.ts` already fixes for a different field; mirrored here
 * rather than reusing `money` from `./common`, which does not special-case
 * an empty string and would coerce it straight to 0.
 */
const nullableAmount = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: "Must be a finite number" });
      return z.NEVER;
    }
    return n;
  });

/** Same NULL-not-0 treatment as `nullableAmount`, for fields stored as a
 *  fraction (0.05 = 5%) rather than a dollar amount. */
const nullableFraction = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      ctx.addIssue({ code: "custom", message: "Must be a fraction between 0 and 1" });
      return z.NEVER;
    }
    return n;
  });

/** A `NOT NULL DEFAULT '0'` rate column, not a nullable one — same
 *  string/number coercion as `nullableFraction` (Task 9's form sends this
 *  field alongside its nullable siblings, so it must tolerate the same
 *  numeric-or-empty-string input), but an empty string or absent key falls
 *  back to the DB's own default instead of becoming null. */
const requiredFraction = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      ctx.addIssue({ code: "custom", message: "Must be a fraction between 0 and 1" });
      return z.NEVER;
    }
    return n;
  });

const nullableYear = year.nullable().optional();

const base = {
  carrier: z.string().trim().max(200).nullable().optional(),
  contractNumberLast4: z.string().trim().max(4).nullable().optional(),
  productType: z.enum(PRODUCT_TYPES).optional().default("fixed"),
  taxTreatment: z.enum(TAX_TREATMENTS).optional().default("non_qualified"),
  // Investment in the contract (§72 basis). NULL = "advisor hasn't told us
  // yet" — see nullableAmount above for why an empty box must not become 0.
  costBasis: nullableAmount,

  // Accumulation-phase drags.
  surrenderChargePct: nullableFraction,
  surrenderEndYear: nullableYear,
  annualFeePct: requiredFraction,

  // Income phase.
  incomeMode: z.enum(INCOME_MODES).optional().default("none"),
  incomeStartYear: nullableYear,
  incomeStartYearRef: z.enum(YEAR_REFS as unknown as [string, ...string[]]).nullable().optional(),
  payoutStructure: z.enum(PAYOUT_STRUCTURES).nullable().optional(),
  survivorPct: nullableFraction,
  periodCertainYears: z.number().int().nonnegative().nullable().optional(),

  // Rider (income_mode = 'rider').
  benefitBase: nullableAmount,
  rollupRate: nullableFraction,
  rollupEndYear: nullableYear,
  rollupRatchets: z.boolean().optional().default(true),
  riderFeePct: nullableFraction,
  // NULL = derive from the age band table in engine/annuity/benefit-base.ts.
  payoutPct: nullableFraction,

  // Annuitized (income_mode = 'annuitized').
  annuitizedPayment: nullableAmount,
  // NULL = derive from the mortality table. Not a fraction — an expected
  // number of years — so it reuses nullableAmount's plain finite-number check.
  expectedReturnYears: nullableAmount,
};

/**
 * Mirrors the three DB CHECK constraints on `annuity_contracts`
 * (`annuity_rider_needs_benefit_base`, `annuity_annuitized_needs_payment`,
 * `annuity_income_needs_start`) so the caller gets a readable 400 instead of
 * a raw Postgres constraint violation.
 */
function refineAnnuityContract(
  d: {
    incomeMode: string;
    benefitBase?: number | null;
    annuitizedPayment?: number | null;
    incomeStartYear?: number | null;
    incomeStartYearRef?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (d.incomeMode === "rider" && d.benefitBase == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["benefitBase"],
      message: "An income rider needs a benefit base.",
    });
  }
  if (d.incomeMode === "annuitized" && d.annuitizedPayment == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["annuitizedPayment"],
      message: "An annuitized contract needs an annual payment.",
    });
  }
  if (d.incomeMode !== "none" && d.incomeStartYear == null && d.incomeStartYearRef == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["incomeStartYear"],
      message: "Set when the income starts.",
    });
  }
}

export const annuityContractSchema = z.object(base).strict().superRefine(refineAnnuityContract);

export type AnnuityContractInput = z.infer<typeof annuityContractSchema>;
