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

// Lenient — used on autosave so half-filled drafts persist.
//
// NOTE: we deliberately do NOT build these from `<strict>.partial()`. `.partial()`
// only makes keys *optional*; a key that is *present* still has to satisfy its
// validators. A freshly-added blank row carries `name: ""`, and "" fails the
// strict `min(1)` — so `.partial()` would 422 every autosave the moment the user
// clicks "Add income". Likewise a mid-typed retirement age ("4") fails the
// strict `min(40)`. The draft variants keep the abuse caps (max length / array
// size) but relax content rules so any in-progress value round-trips. Strict
// validation runs on submit.
const draftStr = (max: number) => z.string().trim().max(max).optional();
const draftDate = z.string().max(10).optional(); // ISO-shape enforced on submit

const intakePersonDraftSchema = z.object({
  firstName: draftStr(100),
  lastName: draftStr(100),
  dateOfBirth: draftDate,
  maritalStatus: z.enum(["single", "married", "divorced", "widowed"]).optional(),
});

const intakeChildDraftSchema = z.object({
  firstName: draftStr(100),
  lastName: draftStr(100),
  dateOfBirth: draftDate,
});

const intakeAccountDraftSchema = z.object({
  name: draftStr(120),
  category: z.enum(["taxable", "cash", "retirement", "annuity", "life_insurance"]).optional(),
  value: z.number().max(1e12).optional(),
  custodian: draftStr(120),
});

const intakeIncomeDraftSchema = z.object({
  name: draftStr(120),
  type: z.enum(["salary", "social_security", "business", "other"]).optional(),
  annualAmount: z.number().max(1e10).optional(),
  owner: z.enum(["client", "spouse", "joint"]).optional(),
});

const intakePropertyDraftSchema = z.object({
  name: draftStr(120),
  kind: z.enum(["real_estate", "business"]).optional(),
  value: z.number().max(1e12).optional(),
});

const intakeGoalsDraftSchema = z.object({
  clientRetirementAge: z.number().max(150).optional(),
  spouseRetirementAge: z.number().max(150).optional(),
  annualRetirementExpenses: z.number().max(1e9).optional(),
});

export const intakeDraftSchema = z.object({
  family: z.object({
    primary: intakePersonDraftSchema.optional(),
    spouse: intakePersonDraftSchema.nullable().optional(),
    stateOfResidence: z.string().max(2).optional(),
    children: z.array(intakeChildDraftSchema).max(20).optional(),
  }).optional(),
  accounts: z.array(intakeAccountDraftSchema).max(50).optional(),
  income: z.array(intakeIncomeDraftSchema).max(50).optional(),
  property: z.array(intakePropertyDraftSchema).max(50).optional(),
  goals: intakeGoalsDraftSchema.optional(),
  meta: intakeMetaSchema.partial().optional(),
}).strip();

export type IntakePayload = z.infer<typeof intakeSubmitSchema>;
export type IntakeDraft = z.infer<typeof intakeDraftSchema>;

/**
 * Drop optional rows the user added but left entirely untouched, so a stray
 * blank card (e.g. "Add income" then "Skip for now") doesn't fail the strict
 * submit validator with a confusing "complete the required fields" message.
 *
 * Only *fully* blank rows are removed — a row with a name (or any value) is
 * kept so the strict schema still flags genuinely-incomplete entries. Pure +
 * non-mutating; safe to run on a draft before `intakeSubmitSchema.parse`.
 */
export function pruneIntakeBlankRows(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object") return payload;
  const p = payload as Record<string, unknown>;

  const blankStr = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
  const blankNum = (v: unknown) => v === undefined || v === null || v === 0;

  const rows = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const accounts = rows<Record<string, unknown>>(p.accounts).filter(
    (a) => !(blankStr(a.name) && blankNum(a.value) && blankStr(a.custodian)),
  );
  const income = rows<Record<string, unknown>>(p.income).filter(
    (i) => !(blankStr(i.name) && blankNum(i.annualAmount)),
  );
  const property = rows<Record<string, unknown>>(p.property).filter(
    (pr) => !(blankStr(pr.name) && blankNum(pr.value)),
  );

  const family = p.family && typeof p.family === "object"
    ? (p.family as Record<string, unknown>)
    : undefined;
  const children = family
    ? rows<Record<string, unknown>>(family.children).filter(
        (c) => !(blankStr(c.firstName) && blankStr(c.lastName) && blankStr(c.dateOfBirth)),
      )
    : undefined;

  return {
    ...p,
    ...(Array.isArray(p.accounts) ? { accounts } : {}),
    ...(Array.isArray(p.income) ? { income } : {}),
    ...(Array.isArray(p.property) ? { property } : {}),
    ...(family ? { family: { ...family, ...(Array.isArray(family.children) ? { children } : {}) } } : {}),
  };
}

export function maritalToFilingStatus(
  m: "single" | "married" | "divorced" | "widowed" | undefined,
): "single" | "married_joint" | "head_of_household" {
  return m === "married" ? "married_joint" : "single";
}

/**
 * Lightweight recipient-email check shared by the intake send surfaces (advisor
 * send-client + send-prospect forms and the create route). Intentionally
 * permissive — the authoritative validation is Resend's / Clerk's at send time.
 */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
