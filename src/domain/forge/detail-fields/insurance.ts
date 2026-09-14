import type { DetailEntity } from "./types";
import { YEAR_REFS as YEAR_REF_VALUES } from "@/lib/milestones";

// ─────────────────────────────────────────────────────────────────────────
// Insurance tab (`src/app/(app)/clients/[id]/details/insurance/page.tsx`)
// Views: `insurance-panel.tsx` (life insurance) and `disability-panel.tsx`.
//
// TRAP 1 — a life-insurance policy is TWO rows, not one. Creating/editing a
// policy writes an `accounts` row (category "life_insurance") AND a
// `lifeInsurancePolicies` row keyed 1:1 by `accountId`. The zod `policyType`
// enum uses SHORT names ("term"/"whole"/"universal"/"variable" — stored on
// `life_insurance_policies.policy_type`), which the route maps to LONGER
// `accounts.sub_type` values via `mapPolicyTypeToSubType`:
//   term -> "term" | whole -> "whole_life" | universal -> "universal_life"
//   | variable -> "variable_life"
// A Forge write must send the SHORT payload enum; the long form is a
// database-only detail it should never see or emit.
//
// TRAP 2 — the PATCH schemas here (`insurancePolicyUpdateSchema`,
// `disabilityPolicyUpdateSchema`) use `strictPartial(...)`, not `.partial()`.
// Zod 4's `.optional()` wraps a `ZodDefault` rather than removing it, so a
// plain `.partial()` would re-fire every default for a key the caller never
// sent — and both PATCH routes write any key that is `!== undefined`. A
// one-key body must contain ONLY the keys actually changing; never fill in
// the rest from current values or from schema defaults, and never send
// `cashValueSchedule` unless the intent is to replace every schedule row.
export const INSURANCE_ENTITIES: readonly DetailEntity[] = [
  {
    id: "life_insurance_policy",
    label: "Life insurance policy",
    tab: "insurance",
    surface: "Insurance → + Add policy (Details tab of the policy dialog)",
    table: "lifeInsurancePolicies",
    routes: {
      list: "/insurance-policies",
      create: "/insurance-policies",
      update: "/insurance-policies/[policyId]",
      delete: "/insurance-policies/[policyId]",
    },
    createSchema: {
      module: "@/lib/schemas/insurance-policies",
      export: "insurancePolicyCreateSchema",
    },
    // Both list/create routes read `getBaseCaseScenarioId` themselves — there
    // is no scenarioId in the payload, and the write always lands on the
    // client's base-case scenario regardless of which scenario is open.
    scenarioScoped: true,
    fields: [
      {
        key: "name",
        label: "Name",
        kind: "string",
        required: true,
        notes: "min 1 / max 200 chars (trimmed).",
      },
      {
        key: "policyType",
        label: "Policy type",
        kind: "enum",
        enumValues: ["term", "whole", "universal", "variable"],
        required: true,
        notes:
          "SHORT payload form. On-screen options are Term / Whole Life / Universal Life / " +
          "Variable Life. Maps server-side to accounts.subType: term→term, whole→whole_life, " +
          "universal→universal_life, variable→variable_life (mapPolicyTypeToSubType in the " +
          "route) — Forge must send the short form, never the accounts.subType spelling.",
      },
      {
        key: "insuredPerson",
        label: "Insured person",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        required: true,
      },
      {
        key: "ownerRef",
        label: "Owner",
        kind: "object",
        required: true,
        notes:
          "Discriminated union, not a plain enum: {kind:\"joint\"} | " +
          "{kind:\"family\",id} | {kind:\"entity\",id} | {kind:\"external\",id}. " +
          "\"family\" id is a familyMembers.id (client/spouse/dependent); \"entity\" is a " +
          "trust entities.id; \"external\" is an externalBeneficiaries.id. Validated against " +
          "the client by assertOwnerRefInClient. Written to the account_owners join table " +
          "(NOT a column on accounts or life_insurance_policies) — \"joint\" produces two " +
          "0.5 rows (client + spouse family members), everything else one row at 1.0. On " +
          "PATCH, sending ownerRef fully replaces account_owners for this policy.",
      },
      {
        key: "faceValue",
        label: "Death benefit",
        kind: "money",
        required: true,
        range: { min: 0 },
      },
      {
        key: "cashValue",
        label: "Current cash value",
        kind: "money",
        defaultValue: 0,
        range: { min: 0 },
        notes:
          "Term policies have no cash value (dialog hides the field and shows " +
          "\"Term policies have no cash value\" on the Schedule tab); the column still " +
          "accepts a value for term rows. Written to accounts.value, not a policy column.",
      },
      {
        key: "costBasis",
        label: "Cost basis",
        kind: "money",
        defaultValue: 0,
        range: { min: 0 },
        notes: "Cumulative premiums paid; reduces taxable gain on surrender.",
      },
      {
        key: "premiumAmount",
        label: "Annual premium",
        kind: "money",
        defaultValue: 0,
        range: { min: 0 },
      },
      {
        key: "premiumYears",
        label: "Premium payment years",
        kind: "number",
        nullable: true,
        defaultValue: null,
        range: { min: 1 },
        notes: "Integer. Null/omitted means ongoing (dialog help text: \"Leave empty for ongoing\").",
      },
      {
        key: "premiumPayer",
        label: "Paid by",
        kind: "enum",
        enumValues: ["owner", "client", "spouse", "both"],
        defaultValue: "owner",
        notes:
          "Field is hidden on screen (and defaults to \"owner\") whenever the Owner is a " +
          "household principal or Joint — the \"Paid by\" choice only matters when someone " +
          "other than the insured household pays (a trust, external person, or non-principal " +
          "family member), where a non-owner payer is treated as a gift.",
      },
      {
        key: "termIssueYear",
        label: "Term issue year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
        notes:
          "required: true only when policyType === \"term\" (enforced by superRefine, not " +
          "the base object shape). Kept in lockstep with the Activation-year picker on the " +
          "Details tab for term policies.",
      },
      {
        key: "termLengthYears",
        label: "Term length (years)",
        kind: "number",
        nullable: true,
        range: { min: 1 },
        notes:
          "Term policies only. superRefine requires exactly one of termLengthYears / " +
          "endsAtInsuredRetirement to be set (mutually exclusive) when policyType === \"term\".",
      },
      {
        key: "endsAtInsuredRetirement",
        label: "Term ends at insured's retirement",
        kind: "boolean",
        defaultValue: false,
        notes: "Checkbox, term policies only. See termLengthYears — mutually exclusive with it.",
      },
      {
        key: "cashValueGrowthMode",
        label: "Cash value growth",
        kind: "enum",
        enumValues: ["basic", "free_form"],
        defaultValue: "basic",
        notes:
          "Radio: \"Basic (default growth rate)\" / \"Free-form (year-by-year schedule)\". " +
          "The dialog derives premiumScheduleMode / deathBenefitScheduleMode / " +
          "incomeScheduleMode from this SAME control (all three become \"scheduled\" when " +
          "this is \"free_form\", \"off\" otherwise) — there is no independent UI for them.",
      },
      {
        key: "premiumScheduleMode",
        label: "Cash value growth",
        kind: "enum",
        enumValues: ["off", "scheduled"],
        defaultValue: "off",
        notes:
          "Schema/route-accepted but NOT independently editable on screen — the dialog " +
          "always sets this equal to cashValueGrowthMode === \"free_form\" ? \"scheduled\" : \"off\".",
      },
      {
        key: "deathBenefitScheduleMode",
        label: "Cash value growth",
        kind: "enum",
        enumValues: ["off", "scheduled"],
        defaultValue: "off",
        notes: "Same coupling as premiumScheduleMode — locked to the cashValueGrowthMode radio.",
      },
      {
        key: "incomeScheduleMode",
        label: "Cash value growth",
        kind: "enum",
        enumValues: ["off", "scheduled"],
        defaultValue: "off",
        notes: "Same coupling as premiumScheduleMode — locked to the cashValueGrowthMode radio.",
      },
      {
        key: "postPayoutGrowthRate",
        label: "Growth rate",
        kind: "rate",
        defaultValue: 0.06,
        range: { min: 0, max: 1 },
        notes:
          "Decimal fraction (0.06 = 6%). On screen this is chosen via a dropdown of model " +
          "portfolios / \"Inflation rate\" / \"Custom %\" (postPayoutGrowthSource is UI-only " +
          "derived state, not a payload field) — a \"Custom rate\" numeric input appears only " +
          "when Custom % is selected; otherwise the rate is copied from the selected " +
          "portfolio's blended return or the resolved inflation rate at save time.",
      },
      {
        key: "postPayoutModelPortfolioId",
        label: "Growth rate",
        kind: "uuid",
        nullable: true,
        defaultValue: null,
        notes:
          "Set only when the Growth rate dropdown selects a model portfolio (references " +
          "modelPortfolios.id, ON DELETE SET NULL); null for the Inflation-rate and Custom % choices.",
      },
      {
        key: "activationYear",
        label: "Activates (policy purchased)",
        kind: "year",
        nullable: true,
        defaultValue: null,
        range: { min: 1900, max: 2200 },
        notes:
          "Milestone-year picker; only shown when client milestones resolved. Null = active " +
          "from plan start. For term policies, changing this also updates termIssueYear.",
      },
      {
        key: "activationYearRef",
        label: "Activates (policy purchased)",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        defaultValue: null,
        notes: "Milestone anchor paired with activationYear via the same picker.",
      },
      {
        key: "cashValueSchedule",
        label: "Cash value / premium / death benefit / income by year",
        kind: "array",
        defaultValue: null,
        notes:
          "Rows of the life_insurance_cash_value_schedule_entry entity, sent inline on " +
          "the policy body — there is no child route. Any create or update carrying this " +
          "key REPLACES every existing row, so omit it entirely unless you mean to " +
          "rewrite the whole schedule; sending [] deletes it. Required to be non-empty " +
          "when any of the four schedule modes is set to free_form/scheduled.",
      },
    ],
  },

  // Nested `cashValueSchedule` rows on the policy body — no dedicated
  // per-row route. Persisted only via the parent policy's create (initial
  // rows) and PATCH (full-array replace when the key is present at all;
  // sending `cashValueSchedule: []` deletes every existing row). Validated
  // inline as part of `insurancePolicyCreateSchema` / `insurancePolicyUpdateSchema`
  // — there is no separately-exported schema for one row.
  {
    id: "life_insurance_cash_value_schedule_entry",
    nestedIn: { entity: "life_insurance_policy", key: "cashValueSchedule" },
    label: "Cash value schedule row",
    tab: "insurance",
    surface: "Insurance → policy dialog → Schedule tab",
    table: "lifeInsuranceCashValueSchedule",
    routes: {
      create: "/insurance-policies",
      update: "/insurance-policies/[policyId]",
    },
    scenarioScoped: true,
    fields: [
      {
        key: "year",
        label: "Year",
        kind: "year",
        required: true,
        range: { min: 1900, max: 2200 },
        notes:
          "Full-array replacement: PATCHing `cashValueSchedule` deletes and reinserts every " +
          "row for the policy; omitting the key (not sending it at all) leaves existing rows " +
          "untouched. There is also a CSV upload endpoint " +
          "(POST /insurance-policies/{policyId}/schedule/upload-csv, \"Upload CSV\" link on " +
          "the grid) but it is PARSE-ONLY — it returns `{ rows, errors }` for the advisor to " +
          "review in the grid; the actual write still happens through the policy PATCH above " +
          "when the dialog is saved. Table has a unique(policyId, year) constraint.",
      },
      {
        key: "cashValue",
        label: "Cash Value",
        kind: "money",
        nullable: true,
        notes: "Column heading in the schedule grid; optional per row (blank = not overridden that year).",
      },
      {
        key: "premiumAmount",
        label: "Premium",
        kind: "money",
        nullable: true,
      },
      {
        key: "income",
        label: "Income",
        kind: "money",
        nullable: true,
      },
      {
        key: "deathBenefit",
        label: "Death Benefit",
        kind: "money",
        nullable: true,
      },
    ],
  },

  // Beneficiaries of the policy's underlying account — a generic
  // account-beneficiaries route shared with other account types, reached
  // from the policy dialog's "Beneficiaries" tab. Distinct from `ownerRef`
  // above (who OWNS the policy) — this is who receives the death benefit.
  {
    id: "life_insurance_policy_beneficiary",
    payloadShape: "array",
    label: "Beneficiary",
    tab: "insurance",
    surface: "Insurance → policy dialog → Beneficiaries tab",
    table: "beneficiaryDesignations",
    routes: {
      list: "/accounts/[accountId]/beneficiaries",
      update: "/accounts/[accountId]/beneficiaries",
    },
    createSchema: {
      module: "@/lib/schemas/beneficiaries",
      export: "beneficiarySetSchema",
    },
    scenarioScoped: true,
    fields: [
      {
        key: "tier",
        label: "Primary / Contingent",
        kind: "enum",
        enumValues: ["primary", "contingent", "income", "remainder"],
        required: true,
        notes:
          "The insurance-policy Beneficiaries tab only ever renders and writes \"primary\" " +
          "and \"contingent\" rows (two sections, headed by the capitalized tier name); " +
          "\"income\"/\"remainder\" are schema-valid tier values used elsewhere (e.g. trust " +
          "beneficiaries), not reachable from this tab. PUT is a FULL REPLACEMENT of every " +
          "designation on the account — the whole array must be sent, not just changed rows.",
      },
      {
        key: "percentage",
        label: "% (percent input next to the beneficiary picker)",
        kind: "percent",
        required: true,
        range: { min: 0, max: 100 },
        notes:
          "Whole-number percent (schema: gt(0), lte(100)), NOT a decimal fraction. Each " +
          "tier's percentages must sum to 100 (validateBeneficiarySplit, enforced server-side " +
          "via superRefine); the UI also blocks Save client-side until every tier in use sums to 100.",
      },
      {
        key: "familyMemberId",
        label: "— select beneficiary — (Family option group)",
        kind: "uuid",
        nullable: true,
      },
      {
        key: "externalBeneficiaryId",
        label: "— select beneficiary — (External option group)",
        kind: "uuid",
        nullable: true,
      },
      {
        key: "entityIdRef",
        label: "— select beneficiary — (Trust option group)",
        kind: "uuid",
        nullable: true,
        notes: "Only trust entities are offered in this picker.",
      },
      {
        key: "householdRole",
        label: "— select beneficiary — (Household option group)",
        kind: "enum",
        enumValues: ["client", "spouse"],
        nullable: true,
        notes: "Rendered as \"{clientFirstName} (client)\" / \"{spouseFirstName} (spouse)\".",
      },
      {
        key: "sortOrder",
        label: "Row order",
        kind: "number",
        defaultValue: 0,
        notes: "Not a labeled field on screen — determined by row position in the list; sent as an integer.",
      },
      {
        key: "distributionForm",
        label: "Distribution form",
        kind: "enum",
        enumValues: ["in_trust", "outright"],
        writable: false,
        notes:
          "No control in this tab's UI. Schema-transformed to \"outright\" when tier === " +
          "\"remainder\" and otherwise undefined — meaningless for primary/contingent life " +
          "insurance beneficiaries, which is all this tab writes. Marked non-writable here; " +
          "it is a real field on the shared beneficiaries route for other surfaces (e.g. trust remainder beneficiaries).",
      },
    ],
  },

  {
    id: "disability_policy",
    label: "Disability policy",
    tab: "insurance",
    surface: "Insurance → Add policy / Add workplace coverage",
    table: "disabilityPolicies",
    routes: {
      list: "/disability-policies",
      create: "/disability-policies",
      update: "/disability-policies/[policyId]",
      delete: "/disability-policies/[policyId]",
    },
    createSchema: {
      module: "@/lib/schemas/disability-policies",
      export: "disabilityPolicyCreateSchema",
    },
    // disabilityPolicies has a clientId column and no scenarioId — one row
    // set is visible from every scenario, like life insurance policies but
    // unlike scenario-scoped tables such as accounts.
    scenarioScoped: false,
    fields: [
      {
        key: "name",
        label: "Policy name",
        kind: "string",
        required: true,
        notes:
          "\"Add workplace coverage\" seeds this to \"Group disability\" " +
          "(WORKPLACE_DEFAULTS, exported alongside the schema); \"Add policy\" starts blank.",
      },
      {
        key: "insured",
        label: "Who is covered",
        kind: "enum",
        enumValues: ["client", "spouse"],
        required: true,
      },
      {
        key: "carrier",
        label: "Carrier",
        kind: "string",
        nullable: true,
        defaultValue: null,
        notes:
          "Could not confirm an on-screen label — no control for this field exists in " +
          "disability-policy-dialog.tsx or disability-panel.tsx today. Schema/route/column " +
          "all accept it (trimmed, max 200 chars); label above is inferred from the field name, not copied from the UI.",
      },
      {
        key: "coveredEarningsMode",
        label: "Covered earnings",
        kind: "enum",
        enumValues: ["salary", "manual"],
        defaultValue: "salary",
        notes: "Options read \"Salary in the plan\" / \"A set amount\".",
      },
      {
        key: "coveredEarningsAmount",
        label: "Covered earnings amount",
        kind: "money",
        nullable: true,
        defaultValue: null,
        notes:
          "Only shown, and required (superRefine), when coveredEarningsMode === \"manual\". " +
          "Null under \"salary\" mode — the engine derives covered earnings from plan salary instead.",
      },
      {
        key: "hasShortTerm",
        label: "Short-term coverage",
        kind: "boolean",
        defaultValue: true,
        notes:
          "Toggle switch under the \"Short-term\" section heading. Cross-field rule: " +
          "hasShortTerm and hasLongTerm cannot both be false (a policy must cover something).",
      },
      {
        key: "stdEliminationDays",
        label: "Waiting period (days)",
        kind: "number",
        defaultValue: 7,
        range: { min: 0, max: 730 },
        notes: "Under the Short-term section. stdDurationWeeks*7 must exceed this (duration must outlast the wait).",
      },
      {
        key: "stdBenefitPct",
        label: "Benefit (% of earnings)",
        kind: "rate",
        defaultValue: 0.6,
        range: { min: 0, max: 1 },
        notes: "Decimal fraction (0.6 = 60%); under the Short-term section. Input renders it as a whole percent.",
      },
      {
        key: "stdDurationWeeks",
        label: "Duration (weeks)",
        kind: "number",
        defaultValue: 13,
        range: { max: 520 },
        notes:
          "Schema requires a positive integer (>0) when set; form allows a transient null " +
          "while the advisor is retyping the field (never send 0 — that models a zero-length benefit).",
      },
      {
        key: "stdMonthlyMax",
        label: "Monthly cap",
        kind: "money",
        nullable: true,
        defaultValue: null,
        notes:
          "Null = UNCAPPED, never 0 — a 0 cap pays nothing. Help text: \"Leave blank for no " +
          "cap — group short-term usually has none.\" DB column has no default; the route " +
          "always writes an explicit value (null when omitted).",
      },
      {
        key: "hasLongTerm",
        label: "Long-term coverage",
        kind: "boolean",
        defaultValue: true,
        notes: "Toggle switch under the \"Long-term\" section heading. See hasShortTerm cross-field rule.",
      },
      {
        key: "ltdEliminationDays",
        label: "Waiting period (days)",
        kind: "number",
        defaultValue: 90,
        range: { min: 0, max: 730 },
        notes: "Under the Long-term section (same visible label as stdEliminationDays).",
      },
      {
        key: "ltdBenefitPct",
        label: "Benefit (% of earnings)",
        kind: "rate",
        defaultValue: 0.6,
        range: { min: 0, max: 1 },
        notes: "Decimal fraction; under the Long-term section (same visible label as stdBenefitPct).",
      },
      {
        key: "ltdMonthlyMax",
        label: "Monthly cap",
        kind: "money",
        nullable: true,
        defaultValue: null,
        notes:
          "Null = UNCAPPED. Help text under Long-term: \"Leave blank for no cap.\" The " +
          "disability_policies column default is 10000.00, but the create/update routes " +
          "always send an explicit value (dec(v) → null when v is null/undefined), so that " +
          "DB default never actually fires through this API — WORKPLACE_DEFAULTS supplies 10000 explicitly instead.",
      },
      {
        key: "ltdBenefitPeriodMode",
        label: "Benefits run",
        kind: "enum",
        enumValues: ["to_age", "to_ssnra", "years", "lifetime"],
        defaultValue: "to_age",
        notes:
          "Options read \"To an age\" / \"To Social Security full retirement age\" / " +
          "\"For a number of years\" / \"For life\".",
      },
      {
        key: "ltdBenefitPeriodAge",
        label: "Benefits run to age",
        kind: "number",
        nullable: true,
        defaultValue: 65,
        range: { min: 40, max: 100 },
        notes: "Required (superRefine) when hasLongTerm and ltdBenefitPeriodMode === \"to_age\".",
      },
      {
        key: "ltdBenefitPeriodYears",
        label: "Benefits run for (years)",
        kind: "number",
        nullable: true,
        range: { min: 1, max: 60 },
        notes: "Required (superRefine) when hasLongTerm and ltdBenefitPeriodMode === \"years\".",
      },
      {
        key: "benefitTaxable",
        label: "Benefits are taxable",
        kind: "boolean",
        defaultValue: true,
        notes:
          "Toggle reads \"Taxable\" / \"Tax-free\". Auto-seeded from premiumPayer " +
          "(employer→taxable, insured→tax-free) until the advisor touches it directly, then sticky.",
      },
      {
        key: "colaRate",
        label: "Annual increase (%)",
        kind: "rate",
        defaultValue: 0,
        range: { min: 0, max: 0.2 },
        notes:
          "Decimal fraction stored exactly as the engine/column hold it; the input renders " +
          "it as a whole percent. Also inline-editable from the policy table row (writable " +
          "there as a lone-key PATCH because it is absent from validateCrossFields).",
      },
      {
        key: "annualPremium",
        label: "Annual premium",
        kind: "money",
        defaultValue: 0,
        range: { min: 0 },
        notes: "Also inline-editable from the policy table row, same lone-key-safe exception as colaRate.",
      },
      {
        key: "premiumPayer",
        label: "Who pays the premium",
        kind: "enum",
        enumValues: ["employer", "insured"],
        defaultValue: "employer",
        notes: "Options read \"The employer\" / \"The insured, with after-tax dollars\".",
      },
      {
        key: "notes",
        label: "Notes",
        kind: "text",
        nullable: true,
        defaultValue: null,
        notes:
          "Could not confirm an on-screen label — no control for this field exists in " +
          "disability-policy-dialog.tsx or disability-panel.tsx today. Schema/route/column " +
          "accept it (trimmed, max 2000 chars); label above is inferred from the field name, not copied from the UI.",
      },
    ],
  },
];
