import { z } from "zod";
import { uuidSchema } from "./common";

// --- Coercion building blocks (shared by create + update) ---
// Each GUARDS undefined so an omitted field in a partial update stays undefined
// instead of being coerced/defaulted. Defaults are applied ONLY in the create
// schema, never baked into these shared pieces.

// number | string → validated integer in [1900, 2200].
// Rejects 0, "", negatives, NaN, out-of-range. Used for CREATE (required).
const yearValue = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1900 || n > 2200) {
    ctx.addIssue({ code: "custom", message: "Must be a year between 1900 and 2200" });
    return z.NEVER;
  }
  return n;
});

// Optional variant for UPDATE: undefined passes through; present values are
// range-validated identically to yearValue.
const yearValueOptional = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n) || n < 1900 || n > 2200) {
      ctx.addIssue({ code: "custom", message: "Must be a year between 1900 and 2200" });
      return z.NEVER;
    }
    return n;
  });

// number | string → string, but pass undefined through untouched
const numericStringOptional = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => (v === undefined ? undefined : String(v)));

// growthSource: "inflation" stays, anything else → "custom"; undefined → undefined
const growthSourceOptional = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "inflation" ? "inflation" : "custom"));

const inflationStartYearOptional = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .nullable()
  .optional();

// claimingAge: falsy (absent/null/0/"") → null; truthy → Number(v).
// Mirrors the route's `claimingAge ? Number(claimingAge) : null`.
// On update this sits behind the `!== undefined` spread guard.
const claimingAgeOptional = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? Number(v) : null));

// claimingAgeMonths: null/absent on create → 0; number/string → Number(v).
// On create: default(0) is applied at the schema level.
// On update: same coercion, but undefined stays undefined (truly-partial guard).
const claimingAgeMonthsOptional = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return v != null ? Number(v) : 0;
  });

// piaMonthly: null/absent → null; present → String(v).
// Mirrors the route's `body.piaMonthly != null ? String(body.piaMonthly) : null`.
const piaMonthlyOptional = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v != null ? String(v) : null));

// survivorshipPct: fraction in [0,1]. null/absent → passes through; present → String(v).
// Rejects out-of-range so a 50 (percent) typo can't slip through as 5000%.
const survivorshipPctOptional = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      ctx.addIssue({ code: "custom", message: "Survivorship must be a fraction between 0 and 1" });
      return z.NEVER;
    }
    return String(n);
  });

// Fields shared verbatim by both create and update (no defaults attached).
const shared = {
  ownerEntityId: uuidSchema.nullable().optional(),
  ownerAccountId: uuidSchema.nullable().optional(),
  cashAccountId: uuidSchema.nullable().optional(),
  linkedPropertyId: uuidSchema.nullable().optional(),
  inflationStartYear: inflationStartYearOptional,
  startYearRef: z.unknown().nullable().optional(),
  endYearRef: z.unknown().nullable().optional(),
};

// Nullable string fields that default to null on CREATE (route: `?? null`),
// but stay truly-optional (absent = undefined) on UPDATE.
const nullableStringCreate = {
  taxType: z.string().nullable().optional().default(null),
  ssBenefitMode: z.string().nullable().optional().default(null),
  claimingAgeMode: z.string().nullable().optional().default(null),
};

const nullableStringUpdate = {
  taxType: z.string().nullable().optional(),
  ssBenefitMode: z.string().nullable().optional(),
  claimingAgeMode: z.string().nullable().optional(),
};

function refineBothOwner(
  d: { ownerEntityId?: unknown; ownerAccountId?: unknown; linkedPropertyId?: unknown },
  ctx: z.RefinementCtx,
): void {
  const set = [d.ownerEntityId, d.ownerAccountId, d.linkedPropertyId].filter((v) => v != null);
  if (set.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Set at most one of ownerEntityId, ownerAccountId, linkedPropertyId",
      path: ["linkedPropertyId"],
    });
  }
}

// CREATE: type/name/startYear/endYear required; loose fields default to mirror the POST route.
export const incomeCreateSchema = z
  .object({
    type: z.string().min(1),
    name: z.string().min(1),
    annualAmount: numericStringOptional.default("0"),
    startYear: yearValue,
    endYear: yearValue,
    growthRate: numericStringOptional.default("0.03"),
    growthSource: growthSourceOptional.default("custom"),
    owner: z.string().optional().default("client"),
    claimingAge: claimingAgeOptional.default(null),
    claimingAgeMonths: claimingAgeMonthsOptional.default(0),
    piaMonthly: piaMonthlyOptional.default(null),
    survivorshipPct: survivorshipPctOptional,
    ...shared,
    ...nullableStringCreate,
  })
  .superRefine(refineBothOwner)
  .superRefine((d, ctx) => {
    if (d.linkedPropertyId != null && d.type !== "other") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "linkedPropertyId is only allowed on 'other' income",
        path: ["linkedPropertyId"],
      });
    }
  });

// UPDATE: truly partial — every field optional, NO defaults injected. An omitted
// field stays absent; a present field is coerced identically to create.
export const incomeUpdateSchema = z
  .object({
    type: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    annualAmount: numericStringOptional,
    startYear: yearValueOptional,
    endYear: yearValueOptional,
    growthRate: numericStringOptional,
    growthSource: growthSourceOptional,
    owner: z.string().optional(),
    claimingAge: claimingAgeOptional,
    claimingAgeMonths: claimingAgeMonthsOptional,
    piaMonthly: piaMonthlyOptional,
    survivorshipPct: survivorshipPctOptional,
    ...shared,
    ...nullableStringUpdate,
  })
  .superRefine(refineBothOwner);

export type IncomeCreateInput = z.infer<typeof incomeCreateSchema>;
export type IncomeUpdateInput = z.infer<typeof incomeUpdateSchema>;
