import { z } from "zod";
import { uuidSchema } from "./common";
import { AddBusinessInputSchema } from "./accounts-business";
import { YEAR_REFS } from "@/lib/milestones";

// Local per-file enum (mirrors note-receivable.ts / gifts.ts / gift-series.ts —
// no shared cross-file yearRef export exists yet to reuse).
const yearRefZodEnum = z.enum(YEAR_REFS);

// Single validation path for account create/update. Reproduces the inline
// coercion the POST route (`/api/clients/[id]/accounts`) does today so the
// write-core and Forge tool can share one parse step.
//
// Mirrors liabilities.ts: coercion building blocks GUARD undefined so an
// omitted field in a partial update stays undefined instead of being
// coerced/defaulted. Defaults are applied ONLY in the create schema, never
// baked into the shared pieces (the ghost-defaults bug).

// decOrZero: reproduces the route's inline helper exactly:
//   typeof v === "string" && v.trim() !== "" ? v        (non-empty string → pass through)
//   typeof v === "number"                    ? String(v) (number → stringify)
//   everything else (null/undefined/empty/ws) → "0"
// The undefined guard keeps this truly-optional for update (omitted → undefined).
const decOrZeroOptional = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
    return "0";
  });

// Nullable passthrough — value flows through untouched, undefined stays undefined.
// Route does `growthRate ?? null` / `overridePctOi ?? null` etc., NOT decOrZero.
// number | string | null pass through verbatim; default null applied in create.
const nullablePassthrough = z
  .union([z.number(), z.string()])
  .nullable()
  .optional();

// Fields shared verbatim by both create and update (no defaults attached).
// Loose business/ownership/legacy fields the core (Task 14) reads off parsed.data;
// the real validation lives in AddBusinessInputSchema (via superRefine on create),
// validateOwnersShape / validateAccountOwnershipRules / synthesizeLegacyAccountOwners.
const shared = {
  // Business-only enum — loose/optional here; superRefine enforces requiredness
  // for category === "business". Non-business categories never set it.
  businessType: z
    .enum(["sole_prop", "partnership", "s_corp", "c_corp", "llc", "other"])
    .optional(),
  // Passthrough — core stringifies conditionally for business rows.
  distributionPolicyPercent: z.union([z.number(), z.string()]).nullable().optional(),
  // Passthrough — core defaults to "annual" for business, hard "annual" otherwise.
  flowMode: z.string().optional(),
  businessTaxTreatment: z.string().optional(),
  // Nullable: the form sends `hsaCoverage: null` for every non-HSA account
  // (isHsa ? hsaCoverage : null). The write-core only reads it for HSA
  // retirement rows and stores null otherwise, so null must parse cleanly.
  hsaCoverage: z.string().nullable().optional(),
  // Legacy/ownership fields consumed by ownership helpers in the core.
  owner: z.string().optional(),
  ownerEntityId: uuidSchema.nullable().optional(),
  ownerFamilyMemberId: z.string().optional(),
  isDefaultChecking: z.boolean().optional(),
  // Loose — validateOwnersShape / validateAccountOwnershipRules own the real shape.
  owners: z.array(z.unknown()).optional(),
  // 529 / education_savings fields. Grantor: exactly one of the two may be set
  // (household family member vs. a named outside funder, e.g. a grandparent).
  // Beneficiary: exactly one of the two must be set — enforced by the core's
  // education_savings pre-branch, not here (the schema stays category-agnostic
  // like the rest of `shared`). Roth-rollover fields drive the SECURE 2.0
  // 529→Roth drip; all null/false for every non-529 category.
  grantorFamilyMemberId: z.string().uuid().nullish(),
  grantorName: z.string().max(200).nullish(),
  beneficiaryFamilyMemberId: z.string().uuid().nullish(),
  beneficiaryName: z.string().max(200).nullish(),
  rothRolloverEnabled: z.boolean().optional(),
  rothRolloverStartYear: z.number().int().min(1900).max(2200).nullish(),
  rothRolloverAccountId: z.string().uuid().nullish(),
};

// Nullable FK / null-default fields: default to null on CREATE (route: `?? null`),
// but stay truly-optional (absent = undefined) on UPDATE so no ghost defaults leak.
const nullDefaultCreate = {
  growthRate: nullablePassthrough.default(null),
  priorYearEndValue: nullablePassthrough.default(null),
  modelPortfolioId: uuidSchema.nullable().optional().default(null),
  tickerPortfolioId: uuidSchema.nullable().optional().default(null),
  parentAccountId: uuidSchema.nullable().optional().default(null),
  overridePctOi: nullablePassthrough.default(null),
  overridePctLtCg: nullablePassthrough.default(null),
  overridePctQdiv: nullablePassthrough.default(null),
  overridePctTaxExempt: nullablePassthrough.default(null),
  custodian: z.string().nullable().optional().default(null),
  accountNumberLast4: z.string().nullable().optional().default(null),
  activationYear: z.number().int().gte(1900).lte(2200).nullable().optional().default(null),
  activationYearRef: yearRefZodEnum.nullable().optional().default(null),
};

const nullDefaultUpdate = {
  growthRate: nullablePassthrough,
  priorYearEndValue: nullablePassthrough,
  modelPortfolioId: uuidSchema.nullable().optional(),
  tickerPortfolioId: uuidSchema.nullable().optional(),
  parentAccountId: uuidSchema.nullable().optional(),
  overridePctOi: nullablePassthrough,
  overridePctLtCg: nullablePassthrough,
  overridePctQdiv: nullablePassthrough,
  overridePctTaxExempt: nullablePassthrough,
  custodian: z.string().nullable().optional(),
  accountNumberLast4: z.string().nullable().optional(),
  activationYear: z.number().int().gte(1900).lte(2200).nullable().optional(),
  activationYearRef: yearRefZodEnum.nullable().optional(),
};

// CREATE: name/category required; loose fields default to mirror the POST route's
// insert block. No .strict() — the route silently tolerates extra keys today.
export const accountCreateSchema = z
  .object({
    name: z.string().min(1),
    // Route casts the raw string to the category enum at the DB boundary; keep
    // it a plain string here (Task 14's core casts).
    category: z.string().min(1),
    subType: z.string().optional().default("other"),
    value: decOrZeroOptional.default("0"),
    basis: decOrZeroOptional.default("0"),
    rothValue: decOrZeroOptional.default("0"),
    rmdEnabled: z.boolean().optional().default(false),
    countsTowardAum: z.boolean().optional().default(false),
    growthSource: z.string().optional().default("default"),
    turnoverPct: z.union([z.number(), z.string()]).optional().default("0"),
    annualPropertyTax: z.union([z.number(), z.string()]).optional().default("0"),
    propertyTaxGrowthRate: z.union([z.number(), z.string()]).optional().default("0.03"),
    propertyTaxGrowthSource: z.string().optional().default("custom"),
    titlingType: z.string().optional().default("jtwros"),
    ...nullDefaultCreate,
    ...shared,
  })
  // Business pre-branch absorbed into the schema: invalid business payloads
  // (missing businessType, owners not summing to 100%, etc.) fail here exactly
  // as the route's `AddBusinessInputSchema.safeParse` branch enforces. The
  // schema does NOT derive subType and does NOT merge — that normalization
  // stays in the core (which derives subType via mapBusinessTypeToSubType).
  .superRefine((data, ctx) => {
    if (data.category === "business") {
      const r = AddBusinessInputSchema.safeParse(data);
      if (!r.success) {
        ctx.addIssue({
          code: "custom",
          message: r.error.issues[0]?.message ?? "Invalid business input",
        });
      }
    }
  });

// UPDATE: truly partial — every field optional, NO defaults injected, and NO
// business superRefine (the PUT route does not re-run AddBusinessInputSchema).
// An omitted field stays absent; a present field is coerced identically to create.
export const accountUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  subType: z.string().optional(),
  value: decOrZeroOptional,
  basis: decOrZeroOptional,
  rothValue: decOrZeroOptional,
  rmdEnabled: z.boolean().optional(),
  countsTowardAum: z.boolean().optional(),
  growthSource: z.string().optional(),
  turnoverPct: z.union([z.number(), z.string()]).optional(),
  annualPropertyTax: z.union([z.number(), z.string()]).optional(),
  propertyTaxGrowthRate: z.union([z.number(), z.string()]).optional(),
  propertyTaxGrowthSource: z.string().optional(),
  titlingType: z.string().optional(),
  ...nullDefaultUpdate,
  ...shared,
});

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
