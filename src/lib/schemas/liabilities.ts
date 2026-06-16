import { z } from "zod";
import { uuidSchema } from "./common";

// --- Coercion building blocks ---
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

// coerceToInt: number | string → Number(v); undefined → undefined.
const coerceToIntOptional = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => (v === undefined ? undefined : Number(v)));

// coerceOrNull: number | string | null | undefined → Number(v) when non-null/present; null when null/absent.
// Mirrors the route's `v != null ? Number(v) : null`.
const coerceOrNullOptional = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    return v != null ? Number(v) : null;
  });

// Fields shared verbatim by both create and update (no defaults attached).
const shared = {
  ownerEntityId: uuidSchema.nullable().optional(),
  owners: z.array(z.unknown()).optional(),
};

// Nullable FK fields that default to null on CREATE (route: `?? null`),
// but stay truly-optional (absent = undefined) on UPDATE.
const nullableFkCreate = {
  linkedPropertyId: uuidSchema.nullable().optional().default(null),
  parentAccountId: uuidSchema.nullable().optional().default(null),
  startYearRef: z.unknown().nullable().optional().default(null),
};

const nullableFkUpdate = {
  linkedPropertyId: uuidSchema.nullable().optional(),
  parentAccountId: uuidSchema.nullable().optional(),
  startYearRef: z.unknown().nullable().optional(),
};

// CREATE: name/startYear/termMonths required; loose fields default to mirror the POST route.
export const liabilityCreateSchema = z.object({
  name: z.string().min(1),
  startYear: yearValue,
  termMonths: coerceToIntOptional.pipe(z.number()),
  balance: decOrZeroOptional.default("0"),
  interestRate: decOrZeroOptional.default("0"),
  monthlyPayment: decOrZeroOptional.default("0"),
  startMonth: coerceToIntOptional.default(1),
  termUnit: z.string().optional().default("annual"),
  balanceAsOfMonth: coerceOrNullOptional.default(null),
  balanceAsOfYear: coerceOrNullOptional.default(null),
  isInterestDeductible: z.boolean().optional().default(false),
  ...nullableFkCreate,
  ...shared,
});

// UPDATE: truly partial — every field optional, NO defaults injected.
// An omitted field stays absent; a present field is coerced identically to create.
export const liabilityUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  startYear: yearValueOptional,
  termMonths: coerceToIntOptional,
  balance: decOrZeroOptional,
  interestRate: decOrZeroOptional,
  monthlyPayment: decOrZeroOptional,
  startMonth: coerceToIntOptional,
  termUnit: z.string().optional(),
  balanceAsOfMonth: coerceOrNullOptional,
  balanceAsOfYear: coerceOrNullOptional,
  isInterestDeductible: z.boolean().optional(),
  ...nullableFkUpdate,
  ...shared,
});

export type LiabilityCreateInput = z.infer<typeof liabilityCreateSchema>;
export type LiabilityUpdateInput = z.infer<typeof liabilityUpdateSchema>;
