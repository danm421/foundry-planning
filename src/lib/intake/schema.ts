import { z } from "zod";
import {
  DEFAULT_INTAKE_SECTIONS,
  type IntakeSectionKey,
} from "./sections";
import {
  INTAKE_ACCOUNT_CATEGORY_VALUES,
  INTAKE_ACCOUNT_SUB_TYPE_VALUES,
  isSubTypeOfCategory,
} from "./account-types";

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

// Form offers a curated subset of accountCategoryEnum (manual entry only), plus
// the sub-type inside it — see `account-types.ts` for the offered pairs.
//
// `name` is DERIVED, not typed: the form builds it from type · owner ·
// custodian. It stays required here because every writer produces one and the
// downstream surfaces (CRM note, review diff, accounts.name) all read it.
//
// `owner` carries a default rather than being required (income's is required):
// forms submitted before the field existed still have to parse here — apply
// re-parses the stored payload at apply time, so a required owner would throw
// on every in-flight form. "client" matches the pre-field behaviour, where
// apply left the account owned by the primary.
//
// `subType` is optional for that same reason — a form submitted before the
// picker existed carries none, and apply falls back to the column's "other".
// The refine rejects a sub-type its category doesn't offer: the DB's retirement
// single-owner trigger keys on sub_type, so a mismatched pair (a "joint" cash
// account carrying "traditional_ira") would blow up apply mid-transaction
// rather than failing validation here.
//
// `basis` is the account's tax (cost) basis. Optional — it's only asked for on
// the categories where it drives taxes (taxable / annuity / life insurance),
// and a client who doesn't know it leaves it blank.
export const intakeAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: z.enum(INTAKE_ACCOUNT_CATEGORY_VALUES),
    subType: z.enum(INTAKE_ACCOUNT_SUB_TYPE_VALUES).optional(),
    value: z.number().nonnegative().max(1e12),
    basis: z.number().nonnegative().max(1e12).optional(),
    owner: z.enum(["client", "spouse", "joint"]).default("client"),
    custodian: z.string().trim().max(120).optional(),
  })
  .refine(
    (a) => a.subType === undefined || isSubTypeOfCategory(a.category, a.subType),
    { message: "Account type does not belong to that category", path: ["subType"] },
  );

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

// ── Estate ───────────────────────────────────────────────────────────────────
//
// What an attorney needs before they can draft: how to reach the principals,
// where they legally reside, who they nominate, and how the children inherit.
//
// Deliberately NO dollar amounts and NO re-asking of names or dates of birth —
// the Family step and the plan already hold both, and an estate questionnaire
// that re-asks for balances is the one clients abandon.
//
// Every field is optional even on submit. A client who knows their guardian but
// hasn't settled on a trustee must be able to send what they have; a half-filled
// estate section is exactly the conversation the advisor wants to have, and a
// required field here would instead produce an unsent form.

// The vocabularies live HERE rather than in `estate.ts` for the same reason
// `INTAKE_GOAL_TYPES` does: estate.ts imports this module for them, so the
// dependency only runs one way.
export const INTAKE_FIDUCIARY_ROLES = ["guardian", "trustee", "executor"] as const;
export type IntakeFiduciaryRole = (typeof INTAKE_FIDUCIARY_ROLES)[number];

export const INTAKE_FIDUCIARY_PRIORITIES = ["primary", "backup"] as const;
export type IntakeFiduciaryPriority = (typeof INTAKE_FIDUCIARY_PRIORITIES)[number];

export const INTAKE_CHILD_DISTRIBUTION_PLANS = ["suggested", "custom"] as const;
export type IntakeChildDistributionPlan =
  (typeof INTAKE_CHILD_DISTRIBUTION_PLANS)[number];

const intakePrincipalContactSchema = z.object({
  mobile: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
});

// `name` is a single free-text field, not first/last: the client is naming
// their sister, not filling in a system of record, and "Sarah Klein-Whitmore"
// splits wrong more often than it splits right.
export const intakeFiduciarySchema = z.object({
  role: z.enum(INTAKE_FIDUCIARY_ROLES),
  priority: z.enum(INTAKE_FIDUCIARY_PRIORITIES),
  name: z.string().trim().min(1).max(120),
});

// Contact details hang off the PERSON, not the nomination — the same brother is
// routinely both trustee and executor, and asking for his phone number twice is
// how a form starts feeling like paperwork. Matched to nominations by name; see
// `estate.ts` for the join.
export const intakeFiduciaryContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(80).optional(),
  city: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
});

// `isLegalResidence` answers "is this address your legal residence for document
// purposes" — a snowbird's mailing address and their domicile are different
// facts, and domicile is what decides which state's law governs the documents.
// Undefined means UNANSWERED, which is why it is a tri-state boolean rather
// than defaulting to true: an unasked question must not be recorded as a yes.
//
// The state here is NOT the plan's state of residence. That one drives state
// tax and is owned by the Family step; overwriting it from a mailing address
// would silently re-rate every projection.
export const intakeResidenceSchema = z.object({
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().length(2).optional(),
  postalCode: z.string().trim().max(12).optional(),
  isLegalResidence: z.boolean().optional(),
  legalResidenceNote: z.string().trim().max(300).optional(),
});

export const intakeChildDistributionSchema = z.object({
  plan: z.enum(INTAKE_CHILD_DISTRIBUTION_PLANS).optional(),
  note: z.string().trim().max(2000).optional(),
});

// ── Who inherits ─────────────────────────────────────────────────────────────
//
// The beneficiaries of the ESTATE DOCUMENTS — who the will and trust leave the
// residuary estate to. Deliberately NOT per-account designations (401(k), IRA,
// life insurance): those pass outside the will, they are collected against the
// account they hang off, and folding them in here would produce a list that
// reads as one plan when it is two.
//
// `ref` is a STRUCTURAL reference, never a name, for the same reason the goals'
// `forWhom` is one: a child on this form has no id until apply inserts them,
// and a name breaks the moment the client goes back and fixes a spelling.
//   - "spouse"        — the Family step's spouse
//   - "child:<index>" — index into `family.children`
//   - "other:<n>"     — somebody the family list does not hold. `n` is a
//                       counter, not an index: the ROW carries their name, and
//                       the ref only has to stay unique so two beneficiaries
//                       called "John" remain distinguishable.
export const ESTATE_BENEFICIARY_REF_RE = /^(spouse|child:\d{1,2}|other:\d{1,3})$/;

export const INTAKE_INHERITANCE_SHARING = ["equal", "custom"] as const;
export type IntakeInheritanceSharing = (typeof INTAKE_INHERITANCE_SHARING)[number];

// What happens to a beneficiary's share if they die first. An attorney cannot
// draft without it, and the two answers are genuinely different documents:
// per stirpes sends the share down that branch of the family, per capita
// re-splits it among whoever is left.
export const INTAKE_PREDECEASED_RULES = ["to_their_children", "to_survivors"] as const;
export type IntakePredeceasedRule = (typeof INTAKE_PREDECEASED_RULES)[number];

// `name`, `relationship` and `dateOfBirth` are written for "other:" rows ONLY.
// A child's name and DOB are READ from the Family step — copying them here
// would give the same person two spellings the moment either is edited.
export const intakeBeneficiarySchema = z.object({
  ref: z.string().trim().regex(ESTATE_BENEFICIARY_REF_RE),
  name: z.string().trim().max(120).optional(),
  relationship: z.string().trim().max(80).optional(),
  dateOfBirth: z.string().regex(ISO_DATE).optional(),
  sharePercent: z.number().min(0).max(100).optional(),
});

// `sharePercent` is stored only under `sharing: "custom"` — an equal split is
// DERIVED, so adding or removing a beneficiary re-divides on its own rather
// than leaving a stale set of percentages that no longer sums to 100.
export const intakeInheritanceSchema = z.object({
  spouseFirst: z.boolean().optional(),
  beneficiaries: z.array(intakeBeneficiarySchema).max(20).default([]),
  sharing: z.enum(INTAKE_INHERITANCE_SHARING).optional(),
  ifPredeceased: z.enum(INTAKE_PREDECEASED_RULES).optional(),
});

export const intakeEstateSchema = z.object({
  contact: z
    .object({
      primary: intakePrincipalContactSchema.optional(),
      spouse: intakePrincipalContactSchema.optional(),
    })
    .optional(),
  residence: intakeResidenceSchema.optional(),
  fiduciaries: z.array(intakeFiduciarySchema).max(12).default([]),
  fiduciaryContacts: z.array(intakeFiduciaryContactSchema).max(12).default([]),
  // Optional rather than defaulted, like `estate` itself: a default would put
  // an empty beneficiary list on every form that never asked the question, and
  // `isEstateEmpty` would then read it as an answered section.
  inheritance: intakeInheritanceSchema.optional(),
  childrenDistribution: intakeChildDistributionSchema.optional(),
});

export const intakeMetaSchema = z.object({
  currentSection: z.string().max(40).optional(),
  completedSections: z.array(z.string().max(40)).max(10).default([]),
});

// ── Risk tolerance ───────────────────────────────────────────────────────────
//
// The RTQ answers ride HERE rather than in `risk_questionnaires` because that
// table's client_id is NOT NULL and a prospect form has no client until apply.
// Apply mints the row (see apply.ts) once the client exists.
//
// `rtqVersion` is stamped at SUBMIT time, for exactly the reason the column
// exists: a form answered under v1 must still apply under v1 after v2 ships.
const intakeRiskSchema = z.object({
  answers: z.record(z.string().max(40), z.string().max(40)),
  environmentNote: z.string().trim().max(2000).optional(),
  rtqVersion: z.number().int().min(1).max(1000),
});

const intakeRiskDraftSchema = z.object({
  answers: z.record(z.string().max(40), z.string().max(40)).optional(),
  environmentNote: z.string().trim().max(2000).optional(),
  rtqVersion: z.number().int().min(1).max(1000).optional(),
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
  // Optional rather than defaulted (goals above is defaulted): every consumer
  // already has to handle "this form did not collect Estate", so a default
  // would only produce an empty object that reads as an answered section.
  estate: intakeEstateSchema.optional(),
  // Optional even when the Risk section IS selected: a client may legitimately
  // skip the step, and partial answers are stored but never scored. There is
  // deliberately no superRefine for risk.
  risk: intakeRiskSchema.optional(),
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
  category: z.enum(INTAKE_ACCOUNT_CATEGORY_VALUES).optional(),
  subType: z.enum(INTAKE_ACCOUNT_SUB_TYPE_VALUES).optional(),
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

// Estate's draft variants relax exactly two things: the fiduciary `name`
// (an empty slot card must autosave) and the residence `state` (a half-typed
// two-letter code). Everything else is already optional + capped on submit.
const intakeFiduciaryDraftSchema = z.object({
  role: z.enum(INTAKE_FIDUCIARY_ROLES),
  priority: z.enum(INTAKE_FIDUCIARY_PRIORITIES),
  name: draftStr(120),
});

const intakeFiduciaryContactDraftSchema = z.object({
  name: draftStr(120),
  relationship: draftStr(80),
  city: draftStr(120),
  phone: draftStr(40),
  email: draftStr(200),
});

// `ref` relaxes to a plain capped string here, unlike its strict twin. Nothing
// in the UI can produce a malformed ref — they are generated, never typed — but
// a draft saved by an older client must still round-trip the autosave rather
// than 422 it, and an unknown ref shape is the submit validator's business.
const intakeBeneficiaryDraftSchema = z.object({
  ref: draftStr(40),
  name: draftStr(120),
  relationship: draftStr(80),
  dateOfBirth: draftDate,
  sharePercent: z.number().max(100).optional(),
});

const intakeInheritanceDraftSchema = z.object({
  spouseFirst: z.boolean().optional(),
  beneficiaries: z.array(intakeBeneficiaryDraftSchema).max(20).optional(),
  sharing: z.enum(INTAKE_INHERITANCE_SHARING).optional(),
  ifPredeceased: z.enum(INTAKE_PREDECEASED_RULES).optional(),
});

const intakeEstateDraftSchema = z.object({
  contact: z
    .object({
      primary: intakePrincipalContactSchema.optional(),
      spouse: intakePrincipalContactSchema.optional(),
    })
    .optional(),
  residence: intakeResidenceSchema.extend({ state: draftStr(2) }).optional(),
  fiduciaries: z.array(intakeFiduciaryDraftSchema).max(12).optional(),
  fiduciaryContacts: z.array(intakeFiduciaryContactDraftSchema).max(12).optional(),
  inheritance: intakeInheritanceDraftSchema.optional(),
  childrenDistribution: intakeChildDistributionSchema.optional(),
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
  estate: intakeEstateDraftSchema.optional(),
  risk: intakeRiskDraftSchema.optional(),
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
 * A fiduciary slot the client opened but never named anyone in. `role` and
 * `priority` are NOT content — they come from the slot itself, so counting them
 * would make an untouched card unprunable and 422 the submit on `name.min(1)`.
 */
export function isBlankIntakeFiduciaryRow(row: { name?: unknown }): boolean {
  return blankStr(row.name);
}

/** A contact card the client never typed into. The `name` is not content for
 *  the same reason a slot's role isn't: it is copied from the nomination. */
export function isBlankIntakeFiduciaryContactRow(row: {
  relationship?: unknown;
  city?: unknown;
  phone?: unknown;
  email?: unknown;
}): boolean {
  return (
    blankStr(row.relationship) &&
    blankStr(row.city) &&
    blankStr(row.phone) &&
    blankStr(row.email)
  );
}

/**
 * A beneficiary row the client added by hand and never named.
 *
 * A row pointing at the spouse or at a child on the Family step is ALWAYS
 * content — the ref is the whole answer, and those rows carry nothing else by
 * design. Only a hand-added "other:" row can be empty.
 */
export function isBlankIntakeBeneficiaryRow(row: {
  ref?: unknown;
  name?: unknown;
  relationship?: unknown;
  dateOfBirth?: unknown;
}): boolean {
  const ref = typeof row.ref === "string" ? row.ref.trim() : "";
  if (ref !== "" && !ref.startsWith("other:")) return false;
  return blankStr(row.name) && blankStr(row.relationship) && blankStr(row.dateOfBirth);
}

/**
 * Canonical form for matching two spellings of one fiduciary's name.
 *
 * Lives here, with the prune that uses it, rather than in `estate.ts` — that
 * module imports this one for the enums, so the dependency runs one way.
 */
export function fiduciaryContactKey(name: unknown): string {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
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
  // Children are filtered AND every "child:<index>" ref that points at one is
  // re-indexed to match. A ref is an index into the list as submitted, so a
  // blank card dropped from the middle shifts every child after it — without
  // this, a goal or a beneficiary silently re-points at the wrong sibling.
  const childRefMap = new Map<number, number>();
  const children = family
    ? rows<Record<string, unknown>>(family.children).filter((c, i) => {
        if (blankStr(c.firstName) && blankStr(c.lastName) && blankStr(c.dateOfBirth)) {
          return false;
        }
        childRefMap.set(i, childRefMap.size);
        return true;
      })
    : undefined;

  /**
   * "child:2" → "child:1" once a blank sibling ahead of it is dropped; null
   * when the child the ref named was itself dropped. Any other ref ("client",
   * "spouse", "other:0") passes through untouched — as does every ref on a form
   * that never collected Family, where nothing was re-indexed.
   */
  const remapChildRef = (ref: unknown): string | null => {
    if (typeof ref !== "string") return null;
    const match = ref.match(/^child:(\d{1,2})$/);
    if (!match || !children) return ref;
    const next = childRefMap.get(Number(match[1]));
    return next === undefined ? null : `child:${next}`;
  };

  // Goal cards are nested a level down, under `goals`, rather than being a
  // top-level array — so the spread has to rebuild the goals object, not just
  // swap an array in.
  // Estate: an unnamed slot goes, and so does a contact card nobody is named on
  // any more — the residue of a client who typed "Sara", filled in her phone
  // number, then corrected it to "Sarah". Keeping it would file an attorney-
  // facing note listing a fiduciary who was never nominated.
  const estate = p.estate && typeof p.estate === "object"
    ? (p.estate as Record<string, unknown>)
    : undefined;
  const fiduciaries = estate
    ? rows<Record<string, unknown>>(estate.fiduciaries).filter(
        (f) => !isBlankIntakeFiduciaryRow(f),
      )
    : undefined;
  const inheritance =
    estate && estate.inheritance && typeof estate.inheritance === "object"
      ? (estate.inheritance as Record<string, unknown>)
      : undefined;
  // A beneficiary whose child ref no longer resolves is REMOVED, not blanked:
  // unlike a goal, the row is nothing but the pointer.
  const beneficiaries = inheritance
    ? rows<Record<string, unknown>>(inheritance.beneficiaries)
        .filter((b) => !isBlankIntakeBeneficiaryRow(b))
        .map((b) => ({ ...b, ref: remapChildRef(b.ref) }))
        .filter((b) => typeof b.ref === "string" && b.ref !== "")
    : undefined;

  const namedKeys = new Set((fiduciaries ?? []).map((f) => fiduciaryContactKey(f.name)));
  const fiduciaryContacts = estate
    ? rows<Record<string, unknown>>(estate.fiduciaryContacts).filter(
        (c) =>
          !isBlankIntakeFiduciaryContactRow(c) &&
          namedKeys.has(fiduciaryContactKey(c.name)),
      )
    : undefined;

  const goals = p.goals && typeof p.goals === "object"
    ? (p.goals as Record<string, unknown>)
    : undefined;
  // A goal whose beneficiary was dropped keeps the goal and loses the pointer:
  // the amount and the year are still real answers.
  const expenseGoals = goals
    ? rows<Record<string, unknown>>(goals.expenseGoals)
        .filter((g) => !isBlankIntakeExpenseGoalRow(g))
        .map((g) => {
          if (g.forWhom === undefined) return g;
          const next = remapChildRef(g.forWhom);
          return next === g.forWhom ? g : { ...g, forWhom: next ?? undefined };
        })
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
    ...(estate
      ? {
          estate: {
            ...estate,
            ...(Array.isArray(estate.fiduciaries) ? { fiduciaries } : {}),
            ...(Array.isArray(estate.fiduciaryContacts) ? { fiduciaryContacts } : {}),
            ...(inheritance
              ? {
                  inheritance: {
                    ...inheritance,
                    ...(Array.isArray(inheritance.beneficiaries) ? { beneficiaries } : {}),
                  },
                }
              : {}),
          },
        }
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
