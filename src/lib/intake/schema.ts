import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const intakePersonSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().regex(ISO_DATE),
  maritalStatus: z.enum(["single", "married", "divorced", "widowed"]).optional(),
});

export const intakeChildSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).optional(),
  dateOfBirth: z.string().regex(ISO_DATE),
});

// Form offers a curated subset of accountCategoryEnum (manual entry only).
export const intakeAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(["taxable", "cash", "retirement", "annuity", "life_insurance"]),
  value: z.number().nonnegative().max(1e12),
  custodian: z.string().trim().max(120).optional(),
});

export const intakeIncomeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["salary", "social_security", "business", "other"]),
  annualAmount: z.number().nonnegative().max(1e10),
  owner: z.enum(["client", "spouse", "joint"]),
});

export const intakePropertySchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["real_estate", "business"]),
  value: z.number().nonnegative().max(1e12),
});

export const intakeGoalsSchema = z.object({
  clientRetirementAge: z.number().int().min(40).max(100).optional(),
  spouseRetirementAge: z.number().int().min(40).max(100).optional(),
  annualRetirementExpenses: z.number().nonnegative().max(1e9).optional(),
});

export const intakeMetaSchema = z.object({
  currentSection: z.string().max(40).optional(),
  completedSections: z.array(z.string().max(40)).max(10).default([]),
});

// Strict — used on submit + on apply.
export const intakeSubmitSchema = z.object({
  family: z.object({
    primary: intakePersonSchema,
    spouse: intakePersonSchema.nullable().optional(),
    stateOfResidence: z.string().length(2).optional(),
    children: z.array(intakeChildSchema).max(20).default([]),
  }),
  accounts: z.array(intakeAccountSchema).max(50).default([]),
  income: z.array(intakeIncomeSchema).max(50).default([]),
  property: z.array(intakePropertySchema).max(50).default([]),
  goals: intakeGoalsSchema.default({}),
  meta: intakeMetaSchema.default({ completedSections: [] }),
});

// Lenient — used on autosave so half-filled drafts persist. Keeps the array
// caps (abuse bound) but makes every section optional and people partial.
export const intakeDraftSchema = z.object({
  family: z.object({
    primary: intakePersonSchema.partial().optional(),
    spouse: intakePersonSchema.partial().nullable().optional(),
    stateOfResidence: z.string().max(2).optional(),
    children: z.array(intakeChildSchema.partial()).max(20).optional(),
  }).optional(),
  accounts: z.array(intakeAccountSchema.partial()).max(50).optional(),
  income: z.array(intakeIncomeSchema.partial()).max(50).optional(),
  property: z.array(intakePropertySchema.partial()).max(50).optional(),
  goals: intakeGoalsSchema.optional(),
  meta: intakeMetaSchema.partial().optional(),
}).strip();

export type IntakePayload = z.infer<typeof intakeSubmitSchema>;
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;

export function maritalToFilingStatus(
  m: "single" | "married" | "divorced" | "widowed" | undefined,
): "single" | "married_joint" | "head_of_household" {
  return m === "married" ? "married_joint" : "single";
}
