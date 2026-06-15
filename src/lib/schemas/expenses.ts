import { z } from "zod";
import { uuidSchema } from "./common";

// --- Coercion building blocks (shared by create + update) ---
// Each GUARDS undefined so an omitted field in a partial update stays undefined
// instead of being coerced/defaulted. Defaults are applied ONLY in the create
// schema, never baked into these shared pieces.

// number | string → number (mirrors Number(startYear) in the route handlers)
const yearCoerce = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v));

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

// Fields shared by both schemas verbatim (no create-only defaults attached).
const shared = {
  ownerEntityId: uuidSchema.nullable().optional(),
  ownerAccountId: uuidSchema.nullable().optional(),
  cashAccountId: uuidSchema.nullable().optional(),
  inflationStartYear: inflationStartYearOptional,
  startYearRef: z.unknown().nullable().optional(),
  endYearRef: z.unknown().nullable().optional(),
  deductionType: z.string().nullable().optional(),
  endsAtMedicareEligibilityOwner: z.enum(["client", "spouse"]).nullable().optional(),
};

function refineBothOwner(
  d: { ownerEntityId?: unknown; ownerAccountId?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (d.ownerEntityId != null && d.ownerAccountId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cannot set both ownerEntityId and ownerAccountId",
      path: ["ownerAccountId"],
    });
  }
}

// CREATE: type/name required, loose fields defaulted to mirror the POST route.
export const expenseCreateSchema = z
  .object({
    type: z.string().min(1),
    name: z.string().min(1),
    annualAmount: numericStringOptional.default("0"),
    startYear: yearCoerce,
    endYear: yearCoerce,
    growthRate: numericStringOptional.default("0.03"),
    // No default: an omitted growthSource on create still resolves to "custom"
    // via the route's `growthSource === "inflation" ? ... : "custom"` only when
    // present. To preserve prior behavior (always "custom" on create), default it.
    growthSource: growthSourceOptional.default("custom"),
    ...shared,
  })
  .superRefine(refineBothOwner);

// UPDATE: truly partial — every field optional, NO defaults injected. An omitted
// field stays absent; a present field is coerced identically to create.
export const expenseUpdateSchema = z
  .object({
    type: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    annualAmount: numericStringOptional,
    startYear: yearCoerce.optional(),
    endYear: yearCoerce.optional(),
    growthRate: numericStringOptional,
    growthSource: growthSourceOptional,
    ...shared,
  })
  .superRefine(refineBothOwner);

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
