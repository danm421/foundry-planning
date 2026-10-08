// src/lib/schemas/ltc-policies.ts
import { z } from "zod";
import { strictPartial } from "@/lib/schemas/strict-partial";
import type { LtcPolicyFields } from "@/lib/insurance-policies/ltc-policy-fields";

/**
 * Long-term care policy request shapes. Client-level, like disability.
 *
 * The body IS the engine's flat `LtcPolicy` minus `id`, so the base routes, a
 * scenario payload and the engine read one shape. Fields a kind does not use
 * travel as null (or 0) — see `normalizeLtcPolicyFields`.
 *
 * CLIENT-SAFE: imports only zod and strict-partial (plus an erased type). The
 * dialog imports it.
 */
// `satisfies` checks both ways: a new `LtcPolicy` field missing here, or a key
// here the policy lacks, fails tsc — `ltcFieldsToColumns` and PATCH map only
// these keys, so a missing one would be dropped silently.
const base = {
  name: z.string().trim().min(1).max(200),
  insured: z.enum(["client", "spouse"]),
  carrier: z.string().trim().max(200).nullable().optional(),
  kind: z.enum(["standalone", "life_rider"]).default("standalone"),
  lifePolicyAccountId: z.string().uuid().nullable().optional(),
  issueYear: z.number().int().gte(1950).lte(2100),
  benefitAmount: z.number().gte(0).default(0),
  benefitUnit: z.enum(["day", "month"]).default("month"),
  riderBenefitMode: z.enum(["pct_of_face", "fixed"]).nullable().optional(),
  riderMonthlyPct: z.number().gt(0).lte(0.25).nullable().optional(),
  benefitPeriodMode: z.enum(["years", "lifetime"]).nullable().optional(),
  benefitPeriodYears: z.number().int().gte(1).lte(20).nullable().optional(),
  riderMaxPct: z.number().gt(0).lte(1).nullable().optional(),
  extensionYears: z.number().int().gte(0).lte(10).default(0),
  residualDeathBenefit: z.number().gte(0).default(0),
  eliminationDays: z.number().int().gte(0).lte(730).default(90),
  homeCarePct: z.number().gte(0).lte(1).default(1),
  inflationRider: z.enum(["none", "simple", "compound"]).default("none"),
  inflationRate: z.number().gte(0).lte(0.1).default(0.03),
  benefitType: z.enum(["reimbursement", "indemnity"]).default("reimbursement"),
  sharedCare: z.boolean().default(false),
  annualPremium: z.number().gte(0).default(0),
  premiumPayMode: z.enum(["lifetime", "to_age", "years", "paid_up"]).default("lifetime"),
  premiumPayToAge: z.number().int().gte(40).lte(110).nullable().optional(),
  premiumPayYears: z.number().int().gte(1).lte(60).nullable().optional(),
  partnership: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullable().optional(),
} satisfies Record<keyof LtcPolicyFields, z.ZodType>;

/** Every writable field, in one list. The routes map ONLY these keys to
 *  columns — never `.set(parsed.data)`. */
export const LTC_POLICY_FIELD_KEYS = Object.keys(base) as (keyof typeof base)[];

export type LtcCrossFieldInput = Partial<{
  kind: "standalone" | "life_rider";
  lifePolicyAccountId: string | null;
  benefitAmount: number;
  riderBenefitMode: "pct_of_face" | "fixed" | null;
  riderMonthlyPct: number | null;
  benefitPeriodMode: "years" | "lifetime" | null;
  benefitPeriodYears: number | null;
  riderMaxPct: number | null;
  sharedCare: boolean;
  annualPremium: number;
  premiumPayMode: "lifetime" | "to_age" | "years" | "paid_up";
  premiumPayToAge: number | null;
  premiumPayYears: number | null;
}>;

/** Every rule that spans fields. One list feeds the create schema, the PATCH
 *  route (run on the MERGED row, never on the body alone) and the dialog's
 *  error list, so the three cannot disagree. A missing `kind` reads as
 *  standalone, the column default. */
export function ltcPolicyProblems(d: LtcCrossFieldInput): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  if ((d.kind ?? "standalone") === "life_rider") {
    if (!d.lifePolicyAccountId) add("lifePolicyAccountId", "Pick the life policy this rider is on.");
    if (d.riderBenefitMode == null) add("riderBenefitMode", "Choose how the rider's benefit is set.");
    if (d.riderBenefitMode === "pct_of_face" && d.riderMonthlyPct == null) {
      add("riderMonthlyPct", "Enter the share of the death benefit paid each month.");
    }
    if (d.riderBenefitMode === "fixed" && !(d.benefitAmount != null && d.benefitAmount > 0)) {
      add("benefitAmount", "Enter the rider's benefit amount.");
    }
    if (d.riderMaxPct == null) add("riderMaxPct", "Enter how much of the death benefit the rider can pay out.");
    if (d.annualPremium != null && d.annualPremium > 0) {
      add("annualPremium", "A rider has no premium of its own. Its cost is inside the life policy's premium.");
    }
    if (d.sharedCare === true) add("sharedCare", "Shared care applies to traditional policies only.");
  } else {
    if (d.lifePolicyAccountId) add("lifePolicyAccountId", "Only a rider is linked to a life policy.");
    if (!(d.benefitAmount != null && d.benefitAmount > 0)) add("benefitAmount", "Enter the policy's benefit amount.");
    if (d.benefitPeriodMode == null) add("benefitPeriodMode", "Choose how long benefits last.");
    if (d.benefitPeriodMode === "years" && d.benefitPeriodYears == null) {
      add("benefitPeriodYears", "Enter the number of years benefits last.");
    }
  }
  if (d.premiumPayMode === "to_age" && d.premiumPayToAge == null) add("premiumPayToAge", "Enter the age premiums stop.");
  if (d.premiumPayMode === "years" && d.premiumPayYears == null) {
    add("premiumPayYears", "Enter how many years premiums are paid.");
  }
  return out;
}

export const ltcPolicyCreateSchema = z.object(base).superRefine((d, ctx) => {
  for (const p of ltcPolicyProblems(d)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: p.message, path: [p.path] });
  }
});

/** `strictPartial`, not `.partial()` — in Zod 4 a plain `.partial()` re-fires
 *  every default for an absent key. No cross-field check here: the PATCH route
 *  runs `ltcPolicyProblems` on the stored row merged with the body. */
export const ltcPolicyUpdateSchema = strictPartial(z.object(base));

export type LtcPolicyCreateInput = z.infer<typeof ltcPolicyCreateSchema>;
export type LtcPolicyUpdateInput = z.infer<typeof ltcPolicyUpdateSchema>;

/** The Add dialog's starting values, per kind (spec). Starting points, not a
 *  claimed "typical policy". Beside the schema so the API and the screen cannot
 *  drift on them. */
export const LTC_STANDALONE_DEFAULTS = {
  kind: "standalone",
  lifePolicyAccountId: null,
  benefitAmount: 6000,
  benefitUnit: "month",
  riderBenefitMode: null,
  riderMonthlyPct: null,
  benefitPeriodMode: "years",
  benefitPeriodYears: 3,
  riderMaxPct: null,
  extensionYears: 0,
  residualDeathBenefit: 0,
  eliminationDays: 90,
  homeCarePct: 1,
  inflationRider: "compound",
  inflationRate: 0.03,
  benefitType: "reimbursement",
  sharedCare: false,
  premiumPayMode: "lifetime",
  premiumPayToAge: null,
  premiumPayYears: null,
} as const;

export const LTC_RIDER_DEFAULTS = {
  kind: "life_rider",
  benefitAmount: 0,
  benefitUnit: "month",
  riderBenefitMode: "pct_of_face",
  riderMonthlyPct: 0.02,
  benefitPeriodMode: null,
  benefitPeriodYears: null,
  riderMaxPct: 1,
  extensionYears: 0,
  residualDeathBenefit: 0,
  eliminationDays: 90,
  homeCarePct: 1,
  inflationRider: "none",
  inflationRate: 0.03,
  benefitType: "reimbursement",
  sharedCare: false,
  annualPremium: 0,
  premiumPayMode: "paid_up",
  premiumPayToAge: null,
  premiumPayYears: null,
} as const;
