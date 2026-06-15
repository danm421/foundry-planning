import { z } from "zod";
import { uuidSchema } from "./common";

// Accept number or numeric string and coerce to number (mirrors Number(startYear) in routes).
const yearCoerce = z.union([z.number(), z.string()]).transform((v) => Number(v));

const base = {
  type: z.string().min(1),
  name: z.string().min(1),
  annualAmount: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional()
    .default("0"),
  startYear: yearCoerce,
  endYear: yearCoerce,
  growthRate: z
    .union([z.number(), z.string()])
    .transform((v) => String(v))
    .optional()
    .default("0.03"),
  // Mirrors: growthSource === "inflation" ? "inflation" : "custom"
  growthSource: z
    .string()
    .optional()
    .transform((v) => (v === "inflation" ? "inflation" : "custom")),
  ownerEntityId: uuidSchema.nullable().optional(),
  ownerAccountId: uuidSchema.nullable().optional(),
  cashAccountId: uuidSchema.nullable().optional(),
  inflationStartYear: z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .nullable()
    .optional(),
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

export const expenseCreateSchema = z.object(base).superRefine(refineBothOwner);

export const expenseUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as Record<string, z.ZodTypeAny>,
  )
  .superRefine(refineBothOwner);

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
