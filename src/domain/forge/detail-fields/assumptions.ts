// src/domain/forge/detail-fields/assumptions.ts
//
// Field map for the Assumptions tab (`/clients/[id]/details/assumptions`).
// Six sub-tabs (`./tabs.ts`), five distinct write surfaces:
//
//   - Tax Rates, Growth & Inflation, and Savings & Withdrawals → Surplus Cash
//     Flow all write the SAME `plan_settings` row through the SAME
//     `PUT /api/clients/[id]/plan-settings` route (see
//     src/app/api/clients/[id]/plan-settings/route.ts). They are split into
//     three DetailEntity records here — one per form/sub-tab — purely so
//     `surface` and `fields` stay legible; a Forge tool that writes any of
//     them still hits one endpoint.
//   - Deductions, Tax Adjustments, Account Groups, and the withdrawal-order
//     list inside Savings & Withdrawals each have their own CRUD routes.
//
// `plan_settings` has no advisor-facing CREATE route — the row is seeded once
// in `src/lib/clients/create-client.ts` when the client is created, and every
// write from this tab is a PUT (partial update). So `required` is never set
// on a plan_settings field: there is no CREATE payload to reject one from.
//
// Out of scope on `plan_settings` (columns the three forms below never
// write): `planStartYear`, `planEndYear` (not rendered on this tab at all),
// `selectedBenchmarkPortfolioId`, `useCustomCma`, `defaultGrowthStockOptions`,
// `growthSourceStockOptions` (stock-option growth is edited elsewhere).
import type { DetailEntity } from "./types";
import { USPS_STATE_CODES } from "@/lib/usps-states";
import { growthSourceEnum } from "@/db/schema";
import { YEAR_REFS as YEAR_REF_VALUES } from "@/lib/milestones";

const GROWTH_SOURCE_VALUES = growthSourceEnum.enumValues;

const YEAR_REF_NOTE =
  "Optional milestone anchor paired with the literal year value (MilestoneYearPicker). " +
  "When set, the year is re-resolved server-side on read as milestones shift (e.g. a " +
  "changed retirement age) and the stored literal year is updated to match.";

export const ASSUMPTIONS_ENTITIES: readonly DetailEntity[] = [
  // ── Tax Rates (plan_settings) ──────────────────────────────────────────
  {
    id: "plan_settings_tax_rates",
    label: "Tax Rates",
    tab: "assumptions",
    surface: "Assumptions → Tax Rates",
    table: "planSettings",
    routes: { update: "/plan-settings" },
    scenarioScoped: true,
    fields: [
      {
        key: "taxEngineMode",
        label: "Calculation method",
        kind: "enum",
        enumValues: ["flat", "bracket"],
        defaultValue: "bracket",
        notes: "UI shows this as a two-button toggle (Flat rate / Bracket-based), not a <select>.",
      },
      {
        key: "flatFederalRate",
        label: "Federal rate",
        kind: "rate",
        defaultValue: 0.22,
        notes:
          "Sent only when taxEngineMode is 'flat'; omitted in bracket mode, so the stored " +
          "value is left untouched rather than cleared. No server-side range check.",
      },
      {
        key: "flatStateRate",
        label: "State rate",
        kind: "rate",
        defaultValue: 0.05,
        notes: "No server-side range check — bounded only by the decimal(5,4) column.",
      },
      {
        key: "residenceState",
        label: "State of residence",
        kind: "enum",
        enumValues: USPS_STATE_CODES,
        nullable: true,
        notes:
          "ONE field, written from two mirrored <select>s on this tab (Income Tax and " +
          "Estate Tax sections) — drives both the state income-tax bracket engine and the " +
          "state estate/inheritance-tax engine. Null falls back to the flat-rate fields.",
      },
      {
        key: "coveredByWorkplacePlan",
        label: "Covered by workplace plan",
        kind: "enum",
        enumValues: ["auto", "yes", "no"],
        defaultValue: "auto",
        notes:
          "Written to `clients.covered_by_workplace_plan` (household-level), NOT " +
          "plan_settings — same PUT request and DB transaction, different table. 'Auto' " +
          "defers to the projection's own inference of active plan participation.",
      },
      {
        key: "spouseCoveredByWorkplacePlan",
        label: "{co-client first name} covered by workplace plan",
        kind: "enum",
        enumValues: ["auto", "yes", "no"],
        defaultValue: "auto",
        notes:
          "Same table caveat as coveredByWorkplacePlan (lands on `clients`, not " +
          "plan_settings). Only rendered/sent when the client has a spouse; the on-screen " +
          "label substitutes the spouse's first name.",
      },
      {
        key: "estateAdminExpenses",
        label: "Administrative expenses",
        kind: "money",
        defaultValue: 0,
        range: { min: 0 },
      },
      {
        key: "flatStateEstateRate",
        label: "Override rate",
        kind: "rate",
        defaultValue: 0,
        range: { min: 0, max: 1 },
        notes: "Applied only when residenceState is unset; a selected state uses its own bracket rule instead.",
      },
      {
        key: "irdTaxRate",
        label: "IRD tax rate",
        kind: "rate",
        defaultValue: 0.35,
        range: { min: 0, max: 1 },
      },
      {
        key: "probateCostRate",
        label: "Probate cost rate",
        kind: "rate",
        defaultValue: 0.02,
        range: { min: 0, max: 1 },
      },
      {
        key: "pvDiscountRate",
        label: "PV discount rate",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Blank/null defaults to the plan's inflation rate.",
      },
      {
        key: "lifetimeExemptionCap",
        label: "Lifetime exemption cap",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes:
          "Null/blank means no cap (exemption grows with inflation indefinitely). The UI " +
          "additionally requires a value > 0 before sending anything at all (a 0 or blank " +
          "entry becomes null client-side); the route itself only rejects negative numbers.",
      },
      {
        key: "outOfHouseholdDniRate",
        label: "Out-of-household DNI rate",
        kind: "rate",
        defaultValue: 0.37,
        range: { min: 0, max: 1 },
      },
      {
        key: "priorTaxableGiftsClient",
        label: "{client first name}",
        kind: "money",
        defaultValue: 0,
        range: { min: 0 },
        notes: "Section is 'Prior lifetime gifts'; the on-screen row label is literally the client's first name.",
      },
      {
        key: "priorTaxableGiftsSpouse",
        label: "{co-client first name}",
        kind: "money",
        defaultValue: 0,
        range: { min: 0 },
        notes:
          "Only rendered/sent when the client has a spouse (otherwise the route always " +
          "receives \"0\" for this key). Label is literally the spouse's first name.",
      },
      {
        key: "capitalLossCarryforwardSt",
        label: "Short-term",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes: "Section is 'Capital loss carryforward'.",
      },
      {
        key: "capitalLossCarryforwardLt",
        label: "Long-term",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes:
          "Section is 'Capital loss carryforward'. The FORM (not the route) may pre-fill " +
          "this input from the client's most recently analyzed tax return's Schedule D " +
          "carryover when no value has been saved yet — that autofill is display-only " +
          "until the advisor saves; the route's own default on omission is null.",
      },
    ],
  },

  // ── Growth & Inflation (plan_settings) ─────────────────────────────────
  {
    id: "plan_settings_growth_inflation",
    label: "Growth & Inflation",
    tab: "assumptions",
    surface: "Assumptions → Growth & Inflation",
    table: "planSettings",
    routes: { update: "/plan-settings" },
    scenarioScoped: true,
    fields: [
      {
        key: "inflationRateSource",
        label: "Inflation source",
        kind: "enum",
        enumValues: ["asset_class", "custom"],
        defaultValue: "asset_class",
        notes: "Radio choice between the firm's 'Inflation' asset class and a custom rate.",
      },
      {
        key: "inflationRate",
        label: "Custom",
        kind: "rate",
        nullable: true,
        defaultValue: 0.03,
        notes: "Sent only when inflationRateSource is 'custom'; ignored otherwise (the resolved asset-class rate applies).",
      },
      {
        key: "defaultGrowthTaxable",
        label: "Taxable — Rate",
        kind: "rate",
        defaultValue: 0.07,
      },
      {
        key: "defaultGrowthCash",
        label: "Cash — Rate",
        kind: "rate",
        defaultValue: 0.02,
      },
      {
        key: "defaultGrowthRetirement",
        label: "Retirement — Rate",
        kind: "rate",
        defaultValue: 0.07,
      },
      {
        key: "defaultGrowthRealEstate",
        label: "Real Estate — Rate",
        kind: "rate",
        defaultValue: 0.04,
      },
      {
        key: "defaultGrowthBusiness",
        label: "Business — Rate",
        kind: "rate",
        defaultValue: 0.05,
      },
      {
        key: "defaultGrowthLifeInsurance",
        label: "Life Insurance — Rate",
        kind: "rate",
        defaultValue: 0.03,
      },
      {
        key: "growthSourceTaxable",
        label: "Taxable — Source",
        kind: "enum",
        enumValues: GROWTH_SOURCE_VALUES,
        defaultValue: "inflation",
        notes: "This form's <select> only offers model_portfolio, asset_mix, inflation, or custom for Taxable.",
      },
      {
        key: "growthSourceCash",
        label: "Cash — Source",
        kind: "enum",
        enumValues: GROWTH_SOURCE_VALUES,
        defaultValue: "inflation",
        notes: "This form's <select> only offers model_portfolio, inflation, or custom for Cash (no asset_mix option).",
      },
      {
        key: "growthSourceRetirement",
        label: "Retirement — Source",
        kind: "enum",
        enumValues: GROWTH_SOURCE_VALUES,
        defaultValue: "inflation",
        notes: "This form's <select> only offers model_portfolio, asset_mix, inflation, or custom for Retirement.",
      },
      {
        key: "growthSourceRealEstate",
        label: "Real Estate — Source",
        kind: "enum",
        enumValues: GROWTH_SOURCE_VALUES,
        defaultValue: "inflation",
        notes: "This form's <select> only offers inflation or custom for Real Estate.",
      },
      {
        key: "growthSourceBusiness",
        label: "Business — Source",
        kind: "enum",
        enumValues: GROWTH_SOURCE_VALUES,
        defaultValue: "inflation",
        notes: "This form's <select> only offers inflation or custom for Business.",
      },
      {
        key: "growthSourceLifeInsurance",
        label: "Life Insurance — Source",
        kind: "enum",
        enumValues: GROWTH_SOURCE_VALUES,
        defaultValue: "inflation",
        notes: "This form's <select> only offers inflation or custom for Life Insurance.",
      },
      {
        key: "modelPortfolioIdTaxable",
        label: "Taxable — Source",
        kind: "uuid",
        nullable: true,
        notes:
          "Not a separate on-screen control — it's the chosen option's id when Taxable — " +
          "Source is set to 'model_portfolio'. Null whenever that source isn't selected. " +
          "Must reference a modelPortfolios row belonging to this firm.",
      },
      {
        key: "modelPortfolioIdCash",
        label: "Cash — Source",
        kind: "uuid",
        nullable: true,
        notes: "Same pattern as modelPortfolioIdTaxable, for the Cash category.",
      },
      {
        key: "modelPortfolioIdRetirement",
        label: "Retirement — Source",
        kind: "uuid",
        nullable: true,
        notes: "Same pattern as modelPortfolioIdTaxable, for the Retirement category.",
      },
      {
        key: "taxInflationRate",
        label: "Tax bracket inflation",
        kind: "rate",
        nullable: true,
        notes: "Under 'Advanced'. Blank clears the override; falls back to the general inflation rate for IRS-threshold inflation.",
      },
      {
        key: "ssWageGrowthRate",
        label: "SS wage base growth",
        kind: "rate",
        nullable: true,
        notes: "Under 'Advanced'. Blank clears the override; falls back to general inflation + 0.5%.",
      },
      {
        key: "medicarePremiumInflationRate",
        label: "Medicare premium inflation",
        kind: "rate",
        defaultValue: 0.03,
        range: { min: 0, max: 1 },
        notes:
          "Under 'Advanced'. Cannot be cleared back to blank from this form — the field is " +
          "only included in the PUT body when the input is non-blank, so leaving it blank " +
          "simply leaves the stored value unchanged.",
      },
      {
        key: "medicarePremiumInflationEnabled",
        label: "On",
        kind: "boolean",
        defaultValue: true,
        notes: "Checkbox next to the Medicare premium inflation rate input; always sent (explicit false persists).",
      },
    ],
  },

  // ── Savings & Withdrawals → Surplus Cash Flow (plan_settings) ──────────
  {
    id: "plan_settings_surplus_cash_flow",
    label: "Surplus Cash Flow",
    tab: "assumptions",
    surface: "Assumptions → Savings & Withdrawals → Surplus Cash Flow",
    table: "planSettings",
    routes: { update: "/plan-settings" },
    scenarioScoped: true,
    fields: [
      {
        key: "surplusSpendPct",
        label: "Spend % of surplus",
        kind: "rate",
        defaultValue: 0,
        range: { min: 0, max: 1 },
      },
      {
        key: "surplusSaveAccountId",
        label: "Save remainder to",
        kind: "uuid",
        nullable: true,
        notes:
          "Null/omitted means the household default checking account. The dropdown only " +
          "lists household-level accounts (no ownerEntityId); the route does not itself " +
          "enforce that restriction.",
      },
      {
        key: "surplusSpendAllUntilRetirement",
        label: "Spend all surplus until retirement",
        kind: "boolean",
        defaultValue: false,
        notes: "Explicit false is written, not treated as \"don't touch\" — the route only skips this key when it isn't a boolean at all.",
      },
    ],
  },

  // ── Deductions ──────────────────────────────────────────────────────────
  {
    id: "client_deduction",
    label: "Itemized Deduction",
    tab: "assumptions",
    surface: "Assumptions → Deductions → Add deduction",
    table: "clientDeductions",
    routes: {
      list: "/deductions",
      create: "/deductions",
      update: "/deductions/[deductionId]",
      delete: "/deductions/[deductionId]",
    },
    scenarioScoped: true,
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "enum",
        enumValues: ["charitable", "above_line", "below_line", "property_tax"],
        required: true,
        notes: "'property_tax' is quoted on screen as 'Property Tax (SALT)' and is subject to the SALT cap in the engine.",
      },
      {
        key: "name",
        label: "Name (optional)",
        kind: "string",
        nullable: true,
      },
      {
        key: "owner",
        label: "Owner",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        defaultValue: "joint",
      },
      {
        key: "annualAmount",
        label: "Annual amount ($)",
        kind: "money",
        defaultValue: 0,
        notes: "No server-side range check; the UI input has a client-only min of 0.",
      },
      {
        key: "growthRate",
        label: "Growth rate (% / yr)",
        kind: "rate",
        defaultValue: 0,
      },
      {
        key: "startYear",
        label: "Start year",
        kind: "year",
        required: true,
      },
      {
        key: "endYear",
        label: "End year",
        kind: "year",
        required: true,
      },
      {
        key: "startYearRef",
        label: "Start year",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: YEAR_REF_NOTE,
      },
      {
        key: "endYearRef",
        label: "End year",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: YEAR_REF_NOTE,
      },
    ],
  },

  // ── Tax Adjustments ─────────────────────────────────────────────────────
  {
    id: "client_tax_adjustment",
    label: "Tax Adjustment",
    tab: "assumptions",
    surface: "Assumptions → Tax Adjustments → Add tax adjustment",
    table: "clientTaxAdjustments",
    routes: {
      list: "/tax-adjustments",
      create: "/tax-adjustments",
      update: "/tax-adjustments/[adjustmentId]",
      delete: "/tax-adjustments/[adjustmentId]",
    },
    scenarioScoped: true,
    fields: [
      {
        key: "taxType",
        label: "Tax treatment",
        kind: "enum",
        enumValues: [
          "earned_income",
          "ordinary_income",
          "dividends",
          "capital_gains",
          "qbi",
          "tax_exempt",
          "stcg",
          "muni_interest",
        ],
        required: true,
        notes:
          "'muni_interest' (Municipal bond interest) is tax-free but still counts toward " +
          "IRMAA MAGI and the §86 Social Security test; 'tax_exempt' (Other tax-free " +
          "income) affects neither. Advisors conflate the two.",
      },
      {
        key: "name",
        label: "Description (optional)",
        kind: "string",
        nullable: true,
      },
      {
        key: "owner",
        label: "Owner",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        defaultValue: "joint",
      },
      {
        key: "annualAmount",
        label: "Amount ($)",
        kind: "money",
        defaultValue: 0,
        notes: "SIGNED — a negative amount removes income the plan over-counts elsewhere. No server-side range check.",
      },
      {
        key: "growthRate",
        label: "Growth rate (% / yr)",
        kind: "rate",
        defaultValue: 0,
      },
      {
        key: "startYear",
        label: "Start year",
        kind: "year",
        required: true,
      },
      {
        key: "endYear",
        label: "End year",
        kind: "year",
        required: true,
      },
      {
        key: "startYearRef",
        label: "Start year",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: YEAR_REF_NOTE,
      },
      {
        key: "endYearRef",
        label: "End year",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: YEAR_REF_NOTE,
      },
      {
        key: "withheldMode",
        label: "Tax already paid",
        kind: "enum",
        enumValues: ["none", "amount", "percent"],
        defaultValue: "none",
        notes:
          "Only rendered/relevant when annualAmount > 0. The form force-resets this to " +
          "'none' (and withheldValue to 0) on submit whenever that condition isn't met, " +
          "and withheldMode/withheldValue must be sent together or omitted together.",
      },
      {
        key: "withheldValue",
        label: "Tax already paid",
        kind: "number",
        defaultValue: 0,
        notes:
          "DUAL MEANING, keyed off the sibling withheldMode field: a dollar amount " +
          "(kind money) when withheldMode is 'amount', a 0..1 decimal fraction (kind " +
          "rate) when withheldMode is 'percent' — server-validated to that 0..1 range " +
          "only in the 'percent' case. Meaningless (0) when withheldMode is 'none'.",
      },
    ],
  },

  // ── Account Groups ──────────────────────────────────────────────────────
  {
    id: "account_group",
    label: "Account Group",
    tab: "assumptions",
    surface: "Assumptions → Account Groups → Create/Edit group",
    table: "accountGroups",
    routes: {
      list: "/account-groups",
      create: "/account-groups",
      update: "/account-groups/[groupId]",
      delete: "/account-groups/[groupId]",
    },
    createSchema: { module: "@/lib/account-groups/schemas", export: "createAccountGroupSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "name",
        label: "Name",
        kind: "string",
        required: true,
        range: { min: 1, max: 80 },
        notes:
          "Unique per client, case-insensitive (DB unique index on LOWER(name)) — a " +
          "collision returns 409. Also rejected (409) if it matches a reserved built-in " +
          "group key: all-liquid, taxable, retirement, or cash.",
      },
      {
        key: "description",
        label: "Description (optional)",
        kind: "text",
        nullable: true,
        range: { max: 500 },
      },
      {
        key: "color",
        label: "Color",
        kind: "string",
        nullable: true,
        notes:
          "Must match a 3- or 6-digit hex colour, written #RGB or #RRGGBB; the form " +
          "always sends one (a colour-picker input, defaulting to brand blue).",
      },
      {
        key: "sortOrder",
        label: "Sort order",
        kind: "number",
        defaultValue: 0,
        range: { min: 0, max: 10000 },
        notes: "Accepted by the schema but not exposed anywhere in AccountGroupForm today — every group is created/edited with the default.",
      },
      {
        key: "memberAccountIds",
        label: "Accounts",
        kind: "array",
        nullable: false,
        notes:
          "Array of account UUIDs (taxable/cash/retirement only — illiquid or " +
          "cross-client ids raise a 422 MemberValidationError). Persisted as rows in the " +
          "`accountGroupMembers` join table (account_group_id, account_id); every write " +
          "REPLACES the full member set, it does not diff/merge. Defaults to [] when " +
          "omitted on create; omit entirely on update to leave membership unchanged.",
      },
    ],
  },

  // ── Savings & Withdrawals → Withdrawal Strategy ────────────────────────
  {
    id: "withdrawal_strategy",
    label: "Withdrawal Strategy Entry",
    tab: "assumptions",
    surface: "Assumptions → Savings & Withdrawals → Withdrawal Strategy → Add Entry",
    table: "withdrawalStrategies",
    routes: {
      list: "/withdrawal-strategy",
      create: "/withdrawal-strategy",
      update: "/withdrawal-strategy/[strategyId]",
      delete: "/withdrawal-strategy/[strategyId]",
    },
    scenarioScoped: true,
    fields: [
      {
        key: "accountId",
        label: "Account",
        kind: "uuid",
        required: true,
        notes:
          "The dropdown only offers accounts that are neither the default checking " +
          "account nor entity-owned; the route itself only checks the account belongs to " +
          "this client (assertAccountsInClient), not that eligibility filter.",
      },
      {
        key: "priorityOrder",
        label: "Priority Order",
        kind: "number",
        required: true,
        notes: "Lower runs first when the projection needs to draw down an account. UI enforces a client-only min of 1; the route accepts any number.",
      },
      {
        key: "startYear",
        label: "Start Year",
        kind: "year",
        required: true,
      },
      {
        key: "endYear",
        label: "End Year",
        kind: "year",
        required: true,
      },
      {
        key: "startYearRef",
        label: "Start Year",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: YEAR_REF_NOTE,
      },
      {
        key: "endYearRef",
        label: "End Year",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: YEAR_REF_NOTE,
      },
    ],
  },
];
