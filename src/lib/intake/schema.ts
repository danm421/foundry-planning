import { z } from "zod";
import {
  DEFAULT_INTAKE_SECTIONS,
  type IntakeSectionKey,
} from "./sections";

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

// ── Funded goals ─────────────────────────────────────────────────────────────
//
// A goal the client can put a number and a date on — college, a wedding, a
// second home. Each one becomes an `expenses` row flagged `is_goal` (education
// gets `type: "education"`, which is always a goal; see `lib/goals.ts`).
//
// The form's seven types are a client-facing vocabulary, NOT the DB's four-member
// expenseTypeEnum: only "education" maps across, and everything else lands as
// "other". Keeping them separate is what lets the Goals board say "wedding"
// while the engine only has to know it's a goal-flagged other expense.
export const INTAKE_GOAL_TYPES = [
  "education",
  "wedding",
  "home",
  "vehicle",
  "travel",
  "gift",
  "other",
] as const;

export type IntakeGoalType = (typeof INTAKE_GOAL_TYPES)[number];

/**
 * Legal shapes for a goal's "who is this for": the two principals by role, or a
 * child by INDEX into `family.children`. Lives here rather than in `goal-rows.ts`
 * (which owns the encode/decode helpers) because `goal-rows` imports this module
 * for the enums — the dependency only runs one way.
 */
export const BENEFICIARY_REF_RE = /^(client|spouse|child:\d{1,2})$/;

// `amount` is ONE year's cost in today's dollars — a one-year goal's total, a
// multi-year goal's per-year figure — matching `expenses.annual_amount`. Apply
// writes it with `inflationStartYear = plan start`, the same "today's dollars"
// default the advisor-side expense dialog uses, so the number the client types
// inflates to the goal year rather than being read as a nominal figure there.
//
// `startYear` and `years` are optional/defaulted for the same reason the account
// `owner` is: apply re-parses the stored payload, so a payload written before
// these fields existed still has to parse. A blank start year means "starting
// now" — apply fills in the current year.
//
// `forWhom` is a STRUCTURAL reference — "client", "spouse", or "child:<index
// into family.children>" — never a name. The form's children don't exist as
// family_members rows until apply inserts them, so there is no id to reference
// at fill-in time; a name would survive that but break the moment the client
// goes back and fixes a spelling. See `goal-rows.ts` for the encoding.
export const intakeExpenseGoalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(INTAKE_GOAL_TYPES),
  amount: z.number().nonnegative().max(1e9),
  startYear: z.number().int().min(1900).max(2200).optional(),
  years: z.number().int().min(1).max(60).default(1),
  forWhom: z.string().trim().regex(BENEFICIARY_REF_RE).optional(),
});

// ── "On your radar" ──────────────────────────────────────────────────────────
//
// Goals the client has no numbers for yet but wants on the agenda. Deliberately
// NOT plan data: apply writes them as a CRM note on the household timeline, not
// as expense rows, because a checked box carries no amount and no date — turning
// one into a projected expense would invent both.
export const INTAKE_GOAL_TOPICS = [
  "home",
  "education",
  "wedding",
  "travel",
  "business",
  "family_support",
  "charitable",
  "legacy",
  "care",
  "relocate",
  "career",
  "debt",
] as const;

export type IntakeGoalTopic = (typeof INTAKE_GOAL_TOPICS)[number];

export const intakeGoalsSchema = z.object({
  clientRetirementAge: z.number().int().min(40).max(100).optional(),
  spouseRetirementAge: z.number().int().min(40).max(100).optional(),
  annualRetirementExpenses: z.number().nonnegative().max(1e9).optional(),
  expenseGoals: z.array(intakeExpenseGoalSchema).max(20).default([]),
  topics: z.array(z.enum(INTAKE_GOAL_TOPICS)).max(20).default([]),
  topicsNote: z.string().trim().max(2000).optional(),
});

export const intakeMetaSchema = z.object({
  currentSection: z.string().max(40).optional(),
  completedSections: z.array(z.string().max(40)).max(10).default([]),
});

// Strict — used on submit + on apply.
//
// `family` is OPTIONAL in the base shape and its required-ness is enforced by
// `intakeSubmitSchemaFor` below. Two reasons it is done this way rather than
// building two different object schemas:
//   1. One output type. A conditional `z.object` would make `IntakePayload` a
//      union of two shapes, which every consumer would then have to narrow.
//   2. A family that IS present still has to satisfy its own validators even
//      when the section is excluded — a half-filled family that rode along in
//      a stale draft is bad data either way.
const intakeSubmitBaseSchema = z.object({
  family: z
    .object({
      primary: intakePersonSchema,
      spouse: intakePersonSchema.nullable().optional(),
      stateOfResidence: z.string().length(2).optional(),
      children: z.array(intakeChildSchema).max(20).default([]),
    })
    .optional(),
  accounts: z.array(intakeAccountSchema).max(50).default([]),
  income: z.array(intakeIncomeSchema).max(50).default([]),
  property: z.array(intakePropertySchema).max(50).default([]),
  // The default has to satisfy the OUTPUT type, so the two array members are
  // spelled out — `{}` no longer type-checks now that they're `.default([])`.
  goals: intakeGoalsSchema.default({ expenseGoals: [], topics: [] }),
  meta: intakeMetaSchema.default({ completedSections: [] }),
});

/**
 * The submit/apply validator for a form collecting `sections`.
 *
 * BOTH the submit route AND applyIntake must call this with the form row's own
 * sections. applyIntake re-parses the stored payload, so if only one of the two
 * were section-aware, every docs-only form would submit cleanly and then throw
 * on apply — after a real client had already filled it in.
 */
export function intakeSubmitSchemaFor(sections: readonly IntakeSectionKey[]) {
  return intakeSubmitBaseSchema.superRefine((val, ctx) => {
    if (sections.includes("family") && val.family === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["family"],
        message: "Family is required on a form that collects it",
      });
    }
  });
}

export const intakeSubmitSchema = intakeSubmitSchemaFor(DEFAULT_INTAKE_SECTIONS);

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

const intakeExpenseGoalDraftSchema = z.object({
  name: draftStr(120),
  type: z.enum(INTAKE_GOAL_TYPES).optional(),
  amount: z.number().max(1e9).optional(),
  startYear: z.number().max(2200).optional(),
  years: z.number().max(60).optional(),
  forWhom: draftStr(200),
});

// `topics` is a loose string array here, not the enum: a draft saved against a
// different revision of INTAKE_GOAL_TOPICS must still round-trip rather than 422
// the autosave. The enum runs on submit, which is where an unknown topic should
// surface.
const intakeGoalsDraftSchema = z.object({
  clientRetirementAge: z.number().max(150).optional(),
  spouseRetirementAge: z.number().max(150).optional(),
  annualRetirementExpenses: z.number().max(1e9).optional(),
  expenseGoals: z.array(intakeExpenseGoalDraftSchema).max(20).optional(),
  topics: z.array(z.string().max(40)).max(20).optional(),
  topicsNote: draftStr(2000),
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

export type IntakePayload = z.infer<typeof intakeSubmitBaseSchema>;
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
 * A goal card the client opened and abandoned. `type` and `years` are NOT
 * content — a blank card already carries "other" and 1 from its template, so
 * counting them would make every abandoned card unprunable.
 */
export function isBlankIntakeExpenseGoalRow(row: {
  name?: unknown;
  amount?: unknown;
  startYear?: unknown;
  forWhom?: unknown;
}): boolean {
  return (
    blankStr(row.name) &&
    blankNum(row.amount) &&
    blankNum(row.startYear) &&
    blankStr(row.forWhom)
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

  // Goal cards are nested a level down, under `goals`, rather than being a
  // top-level array — so the spread has to rebuild the goals object, not just
  // swap an array in.
  const goals = p.goals && typeof p.goals === "object"
    ? (p.goals as Record<string, unknown>)
    : undefined;
  const expenseGoals = goals
    ? rows<Record<string, unknown>>(goals.expenseGoals).filter(
        (g) => !isBlankIntakeExpenseGoalRow(g),
      )
    : undefined;

  return {
    ...p,
    ...(Array.isArray(p.accounts) ? { accounts } : {}),
    ...(Array.isArray(p.income) ? { income } : {}),
    ...(Array.isArray(p.property) ? { property } : {}),
    ...(family ? { family: { ...family, ...(Array.isArray(family.children) ? { children } : {}) } } : {}),
    ...(goals
      ? { goals: { ...goals, ...(Array.isArray(goals.expenseGoals) ? { expenseGoals } : {}) } }
      : {}),
  };
}

export function maritalToFilingStatus(
  m: "single" | "married" | "divorced" | "widowed" | undefined,
): "single" | "married_joint" | "head_of_household" {
  return m === "married" ? "married_joint" : "single";
}

/**
 * Lightweight recipient-email check shared by the intake send surfaces (advisor
 * send-client + send-intake forms and the create route). Intentionally
 * permissive — the authoritative validation is Resend's / Clerk's at send time.
 */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Longest recipient name we store — well past any real name, short enough
 *  that the queue and email greeting can't be stuffed with prose. */
const RECIPIENT_NAME_MAX = 200;

/**
 * Normalize an advisor-supplied recipient name for storage: trimmed, capped,
 * and `undefined` (→ null) rather than "" when nothing usable was typed.
 *
 * The empty case matters twice over: every display surface falls back with
 * `recipientName ?? recipientEmail`, which an empty string wins to render a
 * nameless row, and `intake/gate.ts` reads this field as the public link's
 * second identity factor.
 */
export function normalizeRecipientName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, RECIPIENT_NAME_MAX);
  return trimmed.length > 0 ? trimmed : undefined;
}
