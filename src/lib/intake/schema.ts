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
//
// `owner` carries a default rather than being required (income's is required):
// forms submitted before the field existed still have to parse here — apply
// re-parses the stored payload at apply time, so a required owner would throw
// on every in-flight form. "client" matches the pre-field behaviour, where
// apply left the account owned by the primary.
//
// `basis` is the account's tax (cost) basis. Optional — it's only asked for on
// the categories where it drives taxes (taxable / annuity / life insurance),
// and a client who doesn't know it leaves it blank.
export const intakeAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(["taxable", "cash", "retirement", "annuity", "life_insurance"]),
  value: z.number().nonnegative().max(1e12),
  basis: z.number().nonnegative().max(1e12).optional(),
  owner: z.enum(["client", "spouse", "joint"]).default("client"),
  custodian: z.string().trim().max(120).optional(),
});

// `startYear` / `endYear` / `endsAtRetirement` are optional for the same reason
// the account `owner` above carries a default: apply re-parses the stored
// payload, so forms submitted before these fields existed still have to parse.
// Absent years mean exactly the pre-field behaviour — apply spans the row from
// the current year to plan end.
//
// `endsAtRetirement` beats `endYear`: the step clears the year when the box is
// checked, and apply anchors the row to the owner's retirement milestone
// instead of a fixed year. See `income-years.ts`.
export const intakeIncomeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["salary", "social_security", "business", "other"]),
  annualAmount: z.number().nonnegative().max(1e10),
  owner: z.enum(["client", "spouse", "joint"]),
  startYear: z.number().int().min(1900).max(2200).optional(),
  endYear: z.number().int().min(1900).max(2200).optional(),
  endsAtRetirement: z.boolean().default(false),
});

// A mortgage on a property. Presence of the object IS the "yes I have one"
// answer — the step adds it when the box is checked and drops it when cleared.
//
// Every field is optional even on submit: a client who checks the box but can't
// remember their rate must still be able to submit, and the advisor sees the
// declared mortgage on the review screen either way. Apply skips the liability
// when there's no balance to amortize (see apply.ts).
//
// `interestRatePct` is a PERCENT as typed (6.5), not the decimal fraction the
// `liabilities.interest_rate` column stores — apply divides by 100. The name
// carries the unit so the two can't be confused.
//
// `yearsRemaining` is what a client actually knows; the DB wants an origination
// year + full term, so apply anchors the loan at today and treats the remaining
// years as its term.
export const intakeMortgageSchema = z.object({
  balance: z.number().nonnegative().max(1e12).optional(),
  yearsRemaining: z.number().nonnegative().max(60).optional(),
  interestRatePct: z.number().nonnegative().max(30).optional(),
  monthlyPayment: z.number().nonnegative().max(1e7).optional(),
});

// `basis` and `owner` mirror the account schema above, for the same reasons:
// basis is optional because a client may not know it, and owner carries a
// default rather than being required so pre-field payloads still re-parse at
// apply time.
//
// `annualPropertyTax`, `annualInsurance` and `mortgage` are asked for on real
// estate only — the projection reads `annualPropertyTax` on real_estate
// accounts alone, and a business interest carries neither a homeowner's policy
// nor a mortgage. The step clears them when the kind changes away, so a hidden
// field can't submit a stale number.
export const intakePropertySchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["real_estate", "business"]),
  value: z.number().nonnegative().max(1e12),
  basis: z.number().nonnegative().max(1e12).optional(),
  owner: z.enum(["client", "spouse", "joint"]).default("client"),
  annualPropertyTax: z.number().nonnegative().max(1e9).optional(),
  annualInsurance: z.number().nonnegative().max(1e9).optional(),
  mortgage: intakeMortgageSchema.optional(),
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
  basis: z.number().max(1e12).optional(),
  owner: z.enum(["client", "spouse", "joint"]).optional(),
  custodian: draftStr(120),
});

const intakeIncomeDraftSchema = z.object({
  name: draftStr(120),
  type: z.enum(["salary", "social_security", "business", "other"]).optional(),
  annualAmount: z.number().max(1e10).optional(),
  owner: z.enum(["client", "spouse", "joint"]).optional(),
  startYear: z.number().max(2200).optional(),
  endYear: z.number().max(2200).optional(),
  endsAtRetirement: z.boolean().optional(),
});

const intakeMortgageDraftSchema = z.object({
  balance: z.number().max(1e12).optional(),
  yearsRemaining: z.number().max(60).optional(),
  interestRatePct: z.number().max(30).optional(),
  monthlyPayment: z.number().max(1e7).optional(),
});

const intakePropertyDraftSchema = z.object({
  name: draftStr(120),
  kind: z.enum(["real_estate", "business"]).optional(),
  value: z.number().max(1e12).optional(),
  basis: z.number().max(1e12).optional(),
  owner: z.enum(["client", "spouse", "joint"]).optional(),
  annualPropertyTax: z.number().max(1e9).optional(),
  annualInsurance: z.number().max(1e9).optional(),
  mortgage: intakeMortgageDraftSchema.optional(),
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

const blankStr = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
const blankNum = (v: unknown) => v === undefined || v === null || v === 0;

/**
 * "The client added this row but never filled it in." Shared by the submit-time
 * prune below and by the wizard, which offers "Skip for now" only while every
 * row on an optional step is blank — one definition so the two can't drift.
 */
export function isBlankIntakeIncomeRow(row: { name?: unknown; annualAmount?: unknown }): boolean {
  return blankStr(row.name) && blankNum(row.annualAmount);
}

/**
 * Every field the Property step can collect counts, not just name + value: a
 * client who typed only a mortgage balance has given us something, and pruning
 * that row would silently discard it. Ticking the mortgage box without filling
 * anything in is NOT content — there's no number to keep.
 */
export function isBlankIntakePropertyRow(row: {
  name?: unknown;
  value?: unknown;
  basis?: unknown;
  annualPropertyTax?: unknown;
  annualInsurance?: unknown;
  mortgage?: { balance?: unknown; yearsRemaining?: unknown; interestRatePct?: unknown; monthlyPayment?: unknown } | null;
}): boolean {
  const m = row.mortgage;
  return (
    blankStr(row.name) &&
    blankNum(row.value) &&
    blankNum(row.basis) &&
    blankNum(row.annualPropertyTax) &&
    blankNum(row.annualInsurance) &&
    (m == null ||
      (blankNum(m.balance) &&
        blankNum(m.yearsRemaining) &&
        blankNum(m.interestRatePct) &&
        blankNum(m.monthlyPayment)))
  );
}

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

  const rows = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const accounts = rows<Record<string, unknown>>(p.accounts).filter(
    (a) =>
      !(
        blankStr(a.name) &&
        blankNum(a.value) &&
        blankNum(a.basis) &&
        blankStr(a.custodian)
      ),
  );
  const income = rows<Record<string, unknown>>(p.income).filter(
    (i) => !isBlankIntakeIncomeRow(i),
  );
  const property = rows<Record<string, unknown>>(p.property).filter(
    (pr) => !isBlankIntakePropertyRow(pr),
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
