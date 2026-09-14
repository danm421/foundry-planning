// src/domain/forge/detail-fields/net-worth-accounts.ts
//
// The ACCOUNTS half of the Net Worth tab: the account row itself, its ownership
// split, and every satellite an advisor can fill in from a statement —
// holdings, asset mix, beneficiary designations, business flow schedules,
// annuity contracts, and stock-option grants.
//
// Liabilities and the rest of the Net Worth screen live in ./net-worth-other.
//
// Sources, in the order the map trusts them:
//   1. src/lib/schemas/{accounts,accounts-business,holdings,allocations,
//      beneficiaries,flow-overrides,annuities,stock-options}.ts
//   2. the route handlers under src/app/api/clients/[id]/
//   3. src/lib/clients/accounts-writes.ts (the shared write core)
//   4. src/db/schema.ts (column types, enums, nullability, scenario_id)
//   5. the dialogs in src/components/ — for the on-screen label ONLY.
import type { DetailEntity } from "./types";
import { YEAR_REFS } from "@/lib/milestones";
import { accountCategoryEnum, accountSubTypeEnum } from "@/db/schema";

/** `accounts.category` — pgEnum `account_category`. */
const ACCOUNT_CATEGORIES = accountCategoryEnum.enumValues;

/**
 * `accounts.sub_type` — pgEnum `account_sub_type`, ALL values.
 *
 * The dialog only offers the slice that matches the chosen category
 * (`SUB_TYPE_BY_CATEGORY` in add-account-form.tsx); the API accepts any value
 * in the enum. The category → offered sub-types mapping is:
 *   taxable            brokerage · trust · other
 *   cash               savings · checking · other
 *   retirement         traditional_ira · roth_ira · 401k · 403b · hsa · other
 *   annuity            non_qualified · qualified · tax_free
 *   real_estate        primary_residence · rental_property · commercial_property
 *   business           derived from businessType — never sent by the client
 *   life_insurance     term · whole_life · universal_life · variable_life
 *   stock_options      other
 *   education_savings  529
 * cd / money_market / sep_ira / simple_ira / 401a exist for Plaid-imported rows
 * and are not offered in the dialog.
 */
const ACCOUNT_SUB_TYPES = accountSubTypeEnum.enumValues;

/** `year_ref` — the twelve milestone anchors (src/lib/milestones.ts). */
const EXERCISE_TIMINGS = [
  "at_vest",
  "specific_year",
  "year_before_expiration",
  "manual",
] as const;

const SELL_TIMINGS = [
  "immediately",
  "hold_then_sell_year",
  "percent_per_year",
  "hold",
] as const;

export const NET_WORTH_ACCOUNT_ENTITIES: readonly DetailEntity[] = [
  // ────────────────────────────────────────────────────────────────────────
  // The account row itself.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "account",
    label: "Account",
    tab: "net-worth",
    surface: "Net Worth → + Add Asset → Account Details",
    table: "accounts",
    routes: {
      list: "/accounts",
      create: "/accounts",
      update: "/accounts/[accountId]",
      delete: "/accounts/[accountId]",
    },
    createSchema: { module: "@/lib/schemas/accounts", export: "accountCreateSchema" },
    writeCore: "@/lib/clients/accounts-writes",
    scenarioScoped: true,
    forgeTool: { add: "add_account", update: "update_account", remove: "remove_account" },
    fields: [
      {
        key: "name",
        label: "Account Name",
        kind: "string",
        required: true,
        notes: "Minimum one character. Free text — e.g. 'Fidelity Brokerage'.",
      },
      {
        key: "category",
        label: "Category",
        kind: "enum",
        enumValues: ACCOUNT_CATEGORIES,
        required: true,
        notes:
          "Typed as a plain string by the create schema and cast to the pg enum at the DB boundary — an off-enum value is a 500, not a 400. Drives which other fields matter: real_estate unlocks the property-tax fields, business runs a separate validation schema (see business_account), education_savings requires a beneficiary, retirement + sub-type hsa unlocks hsaCoverage. The dialog hides business / life_insurance / notes_receivable — they are created through their own dialogs.",
      },
      {
        key: "subType",
        label: "Account Type",
        kind: "enum",
        enumValues: ACCOUNT_SUB_TYPES,
        defaultValue: "other",
        notes:
          "Only the slice matching the category is offered on screen (see ACCOUNT_SUB_TYPES above). For an annuity the sub-type IS the tax treatment — the same three spellings as annuity_contracts.tax_treatment. For a business account the server DERIVES it from businessType and ignores anything sent. Cannot be changed on a system-managed cash account.",
      },
      {
        key: "value",
        label: "Current Value ($)",
        kind: "money",
        defaultValue: "0",
        notes:
          "Number or numeric string; blank / null / whitespace all coerce to '0'. Read-only on screen when the account derives from its holdings.",
      },
      {
        key: "basis",
        label: "Cost basis ($) — 'Post-tax basis ($)' on a retirement account",
        kind: "money",
        defaultValue: "0",
        notes:
          "ONE column, TWO meanings. On a brokerage or property it is a genuine cost basis (what was paid) and drives capital gains. On a retirement account it is the already-taxed money inside a pre-tax wrapper — nondeductible contributions tracked on Form 8606 — which comes back TAX-FREE pro-rata on every distribution. This is NOT the same figure as a holding's costBasis (see the account_holding entity): the positions' cost basis must never be written here on an IRA. Traditional-IRA sub-types default the field to 0 on screen; every other category mirrors `value`.",
      },
      {
        key: "rothValue",
        label: "Roth Value ($)",
        kind: "money",
        defaultValue: "0",
        notes:
          "Roth-designated portion of `value`. Only meaningful for retirement sub-types 401k / 403b; the engine ignores it elsewhere.",
      },
      {
        key: "growthRate",
        label: "Growth Rate",
        kind: "rate",
        nullable: true,
        defaultValue: null,
        notes:
          "Decimal fraction (0.07 = 7%). Column is numeric(5,4). NULL means 'inherit the plan default for this category' — the route applies no bounds, but the column caps out near 9.9999.",
      },
      {
        key: "growthSource",
        label: "Growth",
        kind: "enum",
        enumValues: [
          "default",
          "model_portfolio",
          "ticker_portfolio",
          "custom",
          "asset_mix",
          "inflation",
          "holdings",
        ],
        defaultValue: "default",
        notes:
          "Where the growth rate comes from. `custom` reads growthRate; `model_portfolio` / `ticker_portfolio` read the matching id field; `asset_mix` reads account_asset_allocations; `holdings` is set by the holdings sync.",
      },
      {
        key: "modelPortfolioId",
        label: "Growth (model portfolio)",
        kind: "uuid",
        nullable: true,
        defaultValue: null,
        notes: "Must belong to the caller's firm. Only read when growthSource is 'model_portfolio'.",
      },
      {
        key: "tickerPortfolioId",
        label: "Growth (fund portfolio)",
        kind: "uuid",
        nullable: true,
        defaultValue: null,
        notes: "Must belong to the caller's firm. Only read when growthSource is 'ticker_portfolio'.",
      },
      {
        key: "countsTowardAum",
        label: "Counts toward AUM",
        kind: "boolean",
        defaultValue: false,
        notes:
          "Include this balance in 'Total book value' on the home screen. Only offered for the AUM-eligible categories (taxable / cash / retirement); the KPI filters on category anyway.",
      },
      {
        key: "rmdEnabled",
        label: "Subject to RMDs",
        kind: "boolean",
        defaultValue: false,
        notes: "Defaulted on screen from the sub-type, but sent explicitly.",
      },
      {
        key: "priorYearEndValue",
        label: "Prior Dec 31 Balance",
        kind: "money",
        nullable: true,
        defaultValue: null,
        notes:
          "Override for the Dec-31 balance the first projection year's RMD is computed from. Ignored after Year 1. Only shown when rmdEnabled.",
      },
      {
        key: "turnoverPct",
        label: "Turnover %",
        kind: "rate",
        defaultValue: "0",
        notes: "Decimal fraction. Portion of long-term capital gains realised as short-term each year.",
      },
      {
        key: "overridePctOi",
        label: "Ordinary Income %",
        kind: "rate",
        nullable: true,
        defaultValue: null,
        notes: "Decimal fraction. Realization-tab override of the account's ordinary-income share of return.",
      },
      {
        key: "overridePctLtCg",
        label: "LT Capital Gains %",
        kind: "rate",
        nullable: true,
        defaultValue: null,
      },
      {
        key: "overridePctQdiv",
        label: "Qualified Dividends %",
        kind: "rate",
        nullable: true,
        defaultValue: null,
      },
      {
        key: "overridePctTaxExempt",
        label: "Tax-Exempt %",
        kind: "rate",
        nullable: true,
        defaultValue: null,
      },
      {
        key: "annualPropertyTax",
        label: "Annual Property Tax",
        kind: "money",
        defaultValue: "0",
        notes: "Real-estate accounts only.",
      },
      {
        key: "propertyTaxGrowthRate",
        label: "Property Tax Growth",
        kind: "rate",
        defaultValue: "0.03",
        notes:
          "Decimal fraction. Real-estate accounts only. When propertyTaxGrowthSource is 'inflation' the engine substitutes the plan's inflation rate and this is a display fallback.",
      },
      {
        key: "propertyTaxGrowthSource",
        label: "Property Tax Growth",
        kind: "enum",
        enumValues: ["custom", "inflation"],
        defaultValue: "custom",
      },
      {
        key: "titlingType",
        label: "Owner(s) — Community Property preset",
        kind: "enum",
        enumValues: ["jtwros", "community_property"],
        defaultValue: "jtwros",
        notes:
          "Not its own control: set by the 'Joint 50/50' vs 'Community Property' preset buttons in the Owner(s) editor. Decides whether a joint account gets a full or half basis step-up at the first death.",
      },
      {
        key: "custodian",
        label: "Custodian",
        kind: "string",
        nullable: true,
        defaultValue: null,
        notes: "Under the 'Account identification' disclosure. Empty string is stored as NULL.",
      },
      {
        key: "accountNumberLast4",
        label: "Acct # (last 4)",
        kind: "string",
        nullable: true,
        defaultValue: null,
        notes:
          "Last four digits only — the input is capped at 4 characters on screen, but the API does NOT enforce a length. Empty string is stored as NULL.",
      },
      {
        key: "activationYear",
        label: "Activates",
        kind: "year",
        nullable: true,
        defaultValue: null,
        range: { min: 1900, max: 2200 },
        notes:
          "The account is absent from the projection until this year, then appears at `value`. NULL = active from plan start. Shown behind the 'Activates in a future year (inheritance, new account)' checkbox.",
      },
      {
        key: "activationYearRef",
        label: "Activates",
        kind: "enum",
        enumValues: YEAR_REFS,
        nullable: true,
        defaultValue: null,
        notes: "Milestone anchor instead of a fixed year, e.g. 'client_retirement'.",
      },
      {
        key: "hsaCoverage",
        label: "HSA Coverage",
        kind: "enum",
        enumValues: ["self", "family"],
        nullable: true,
        notes:
          "Only written when category is 'retirement' AND subType is 'hsa'; NULL for every other account. Anything other than the literal 'family' is stored as 'self'. Drives the contribution cap.",
      },
      {
        key: "parentAccountId",
        label: "Owner(s) — owned by a business",
        kind: "uuid",
        nullable: true,
        defaultValue: null,
        notes:
          "Hangs this account off a business account as a sub-asset. The referenced row must be in the same client AND have category 'business'. Mutually exclusive with owners[] — sending both is a 400; a child inherits its ownership from the parent.",
      },
      {
        key: "owners",
        label: "Owner(s)",
        kind: "array",
        notes:
          "Array of { kind, familyMemberId | entityId, percent }. Percents are decimal FRACTIONS and must sum to 1.0 (±0.0001); duplicates are rejected. Retirement sub-types require exactly one owner at 100%. See the account_owner_split entity for the row shape. Omit the key entirely to fall back to the legacy synthesis path below; send it as [] and the request is rejected ('owners must have at least one entry').",
      },
      {
        key: "owner",
        label: "Owner(s)",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        notes:
          "LEGACY, create-only. Used only when owners[] is omitted: 'joint' synthesises client 50 / spouse 50, 'spouse' gives the spouse 100%, anything else gives the client 100%. Prefer owners[].",
      },
      {
        key: "ownerEntityId",
        label: "Owner(s) — entity",
        kind: "uuid",
        nullable: true,
        notes:
          "LEGACY, create-only. When owners[] is omitted this synthesises a single entity owner at 100%. Must belong to this client. Not a column on `accounts` — it becomes an account_owners row.",
      },
      {
        key: "ownerFamilyMemberId",
        label: "Owner(s) — household member",
        kind: "uuid",
        notes:
          "LEGACY. On create (owners[] omitted) it synthesises a single family-member owner at 100%. The PATCH /accounts/[accountId] handler also accepts it on its own, but there is NO owner_family_member_id column on `accounts` — treat that PATCH path as unreliable and write ownership through owners[] instead.",
      },
      {
        key: "deriveFromHoldings",
        appliesTo: "update",
        label: "Drive this account from holdings",
        kind: "boolean",
        defaultValue: true,
        notes:
          "UPDATE ONLY. The create schema does not carry it and the write core does not insert it, so a new account always lands on the DB default (true); the toggle lives on the Holdings tab and is saved with a PUT. Setting it true triggers syncAccountFromHoldings after the write, which recomputes value / basis / asset mix and forces growthSource.",
      },
      {
        key: "notes",
        appliesTo: "update",
        label: "Notes",
        kind: "text",
        nullable: true,
        notes:
          "UPDATE ONLY — the create schema drops it. Saved from the business dialog's Notes tab via PUT /accounts/[accountId] (the PUT is a permissive mass-assign of any accounts column bar id / clientId / createdAt / updatedAt / plaidItemId / plaidAccountId).",
      },
      {
        key: "businessType",
        label: "Business type",
        kind: "enum",
        enumValues: ["sole_prop", "partnership", "s_corp", "c_corp", "llc", "other"],
        notes:
          "Business accounts only; forced to NULL for every other category. Required when category is 'business' (enforced by AddBusinessInputSchema). Also derives subType.",
      },
      {
        key: "distributionPolicyPercent",
        label: "Distribution policy",
        kind: "rate",
        nullable: true,
        notes:
          "Decimal fraction 0–1: the share of annual business earnings paid out to owners. Business accounts only; NULL elsewhere. Blank = no distribution.",
      },
      {
        key: "flowMode",
        label: "Annual + growth / Schedule",
        kind: "enum",
        enumValues: ["annual", "schedule"],
        defaultValue: "annual",
        notes:
          "Business accounts only — forced to 'annual' for every other category. 'schedule' makes the engine read account_flow_overrides instead of the annual income/expense rows.",
      },
      {
        key: "businessTaxTreatment",
        label: "Tax treatment",
        kind: "enum",
        enumValues: ["qbi", "ordinary", "non_taxable"],
        defaultValue: "qbi",
        notes:
          "Business accounts only (NULL elsewhere); defaults to 'qbi' on a business row. 'qbi' = §199A pass-through eligible for the 20% deduction.",
      },
      {
        key: "grantorFamilyMemberId",
        label: "Grantor household member",
        kind: "uuid",
        nullable: true,
        notes:
          "529 / education_savings only. A household grantor funds contributions out of plan cash flow and may earn a state deduction. Mutually exclusive with grantorName.",
      },
      {
        key: "grantorName",
        label: "Outside grantor name",
        kind: "string",
        nullable: true,
        range: { max: 200 },
        notes:
          "529 / education_savings only. A named outside funder (e.g. a grandparent) — funds the account without touching household cash flow and earns no household deduction.",
      },
      {
        key: "beneficiaryFamilyMemberId",
        label: "Beneficiary family member",
        kind: "uuid",
        nullable: true,
        notes:
          "529 / education_savings only. Exactly one of this and beneficiaryName MUST be set — the write core rejects a 529 with neither, on both create and update.",
      },
      {
        key: "beneficiaryName",
        label: "Named beneficiary",
        kind: "string",
        nullable: true,
        range: { max: 200 },
        notes: "529 / education_savings only. See beneficiaryFamilyMemberId — one of the two is required.",
      },
      {
        key: "rothRolloverEnabled",
        label: "Roll leftover funds to a Roth IRA (SECURE 2.0)",
        kind: "boolean",
        defaultValue: false,
        notes: "529 only. $35,000 lifetime cap per beneficiary, capped at the annual IRA limit per year.",
      },
      {
        key: "rothRolloverStartYear",
        label: "Start year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
        notes: "529 only.",
      },
      {
        key: "rothRolloverAccountId",
        label: "Destination Roth IRA",
        kind: "uuid",
        nullable: true,
        notes:
          "529 only. A household Roth IRA account id. NULL means the funds exit the plan to the beneficiary's own Roth.",
      },
      {
        key: "isDefaultChecking",
        label: "System-managed cash account",
        kind: "boolean",
        writable: false,
        notes:
          "System-managed — never set this. Exactly one account per (client, scenario) carries it; the create path reads it only to relax an ownership rule and never persists it, and the update path locks category / subType / parentAccountId / ownership on such a row and refuses to delete it. It is set by the server when a top-level business auto-provisions its child cash account.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Ownership split — a satellite of the account, written with it.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "account_owner_split",
    nestedIn: { entity: "account", key: "owners" },
    label: "Owner(s)",
    tab: "net-worth",
    surface: "Net Worth → + Add Asset → Account Details → Owner(s)",
    table: "accountOwners",
    routes: { create: "/accounts", update: "/accounts/[accountId]" },
    createSchema: { module: "@/lib/schemas/accounts", export: "accountCreateSchema" },
    writeCore: "@/lib/clients/accounts-writes",
    scenarioScoped: false,
    forgeTool: { add: "add_account", update: "update_account" },
    fields: [
      {
        key: "kind",
        label: "Owner",
        kind: "enum",
        enumValues: ["family_member", "entity"],
        required: true,
        notes:
          "Discriminator. The table also has an external_beneficiary_id column and a CHECK that exactly one of the three ids is set, but the API validator only accepts these two kinds.",
      },
      {
        key: "familyMemberId",
        label: "Owner",
        kind: "uuid",
        notes: "Required when kind is 'family_member'. Must belong to this client.",
      },
      {
        key: "entityId",
        label: "Owner",
        kind: "uuid",
        notes: "Required when kind is 'entity'. Must belong to this client.",
      },
      {
        key: "percent",
        label: "Percent",
        kind: "rate",
        required: true,
        range: { min: 0, max: 1 },
        notes:
          "Decimal FRACTION, not a whole number — 0.5 is half. Every row on an account must sum to 1.0 within 0.0001. Retirement sub-types (traditional_ira / roth_ira / 401k / 403b / hsa / …) require a single row at exactly 1.0.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Holdings.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "account_holding",
    label: "Holding",
    tab: "net-worth",
    surface: "Net Worth → account → Holdings",
    table: "accountHoldings",
    routes: {
      list: "/accounts/[accountId]/holdings",
      create: "/accounts/[accountId]/holdings",
      update: "/accounts/[accountId]/holdings/[holdingId]",
      delete: "/accounts/[accountId]/holdings/[holdingId]",
    },
    createSchema: { module: "@/lib/schemas/holdings", export: "holdingCreateSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "securityId",
        label: "Ticker",
        kind: "uuid",
        nullable: true,
        notes:
          "FK to the shared securities table, set by the ticker classifier. NULL for a fully manual, override-only holding.",
      },
      {
        key: "displayTicker",
        label: "Ticker",
        kind: "string",
        nullable: true,
        range: { min: 1, max: 32 },
        notes: "Trimmed. The Holdings tab requires a ticker before its own Add button enables, but the API does not.",
      },
      {
        key: "displayName",
        label: "Name",
        kind: "string",
        nullable: true,
        range: { max: 200 },
      },
      {
        key: "shares",
        label: "Shares",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes: "JSON number only — a numeric string is rejected (the schema is .strict() and does not coerce).",
      },
      {
        key: "price",
        label: "Price",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes: "Price per share. Refreshed nightly for tickered holdings.",
      },
      {
        key: "priceAsOf",
        label: "Price",
        kind: "date",
        nullable: true,
        notes: "Strict YYYY-MM-DD. Set from the quote lookup when a price is pulled.",
      },
      {
        key: "costBasis",
        label: "Cost basis",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes:
          "What was paid for THIS position. This is NOT an IRA's post-tax basis — see `basis` on the account entity. On a retirement account the holdings roll-up deliberately does NOT drive accounts.basis, precisely because the two are different concepts; writing a position's cost basis into a traditional IRA's post-tax basis would make the whole account distribute tax-free.",
      },
      {
        key: "marketValue",
        label: "Market value",
        kind: "number",
        nullable: true,
        range: { min: 0 },
        notes:
          "Authoritative value when set — used for statement-derived / untickered holdings where shares × price is wrong (a bond quotes per $100 par). NULL for a tickered holding, which derives shares × price.",
      },
      {
        key: "sortOrder",
        label: "Holdings row order",
        kind: "number",
        defaultValue: 0,
        range: { min: 0 },
        notes: "Integer. Not exposed as its own control.",
      },
      {
        key: "notes",
        label: "Notes",
        kind: "text",
        nullable: true,
        range: { max: 1000 },
        notes: "Accepted by the API; the Holdings tab has no notes column.",
      },
    ],
  },

  {
    id: "holding_asset_class_override",
    payloadShape: { wrappedIn: "overrides" },
    label: "Asset classes (holding override)",
    tab: "net-worth",
    surface: "Net Worth → account → Holdings → Asset class",
    table: "holdingAssetClassOverrides",
    routes: { update: "/accounts/[accountId]/holdings/[holdingId]/override" },
    createSchema: { module: "@/lib/schemas/holdings", export: "holdingOverrideSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "assetClassId",
        label: "Asset class",
        kind: "uuid",
        required: true,
        notes: "Per row inside `overrides`. Must be an asset class belonging to the caller's firm.",
      },
      {
        key: "weight",
        label: "Weight",
        kind: "rate",
        required: true,
        range: { min: 0, max: 1 },
        notes: "Per row inside `overrides`. Decimal fraction — 0.6 is 60%.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Asset mix.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "account_asset_allocation",
    payloadShape: { wrappedIn: "allocations" },
    label: "Asset Mix",
    tab: "net-worth",
    surface: "Net Worth → account → Asset Mix",
    table: "accountAssetAllocations",
    routes: {
      list: "/accounts/[accountId]/allocations",
      update: "/accounts/[accountId]/allocations",
    },
    createSchema: { module: "@/lib/schemas/allocations", export: "allocationPutSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "assetClassId",
        label: "Asset class",
        kind: "uuid",
        required: true,
        notes: "Per row inside `allocations`. Must belong to the caller's firm.",
      },
      {
        key: "weight",
        label: "Weight",
        kind: "rate",
        required: true,
        range: { min: 0, max: 1 },
        notes: "Per row inside `allocations`. Decimal fraction — the screen shows it as a percent.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Beneficiary designations.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "account_beneficiary_designation",
    payloadShape: "array",
    label: "Beneficiaries",
    tab: "net-worth",
    surface: "Net Worth → account → Beneficiaries",
    table: "beneficiaryDesignations",
    routes: {
      list: "/accounts/[accountId]/beneficiaries",
      update: "/accounts/[accountId]/beneficiaries",
    },
    createSchema: { module: "@/lib/schemas/beneficiaries", export: "beneficiarySetSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "tier",
        label: "Primary / Contingent",
        kind: "enum",
        enumValues: ["primary", "contingent", "income", "remainder"],
        required: true,
        notes:
          "The account screen only shows Primary and Contingent; 'income' and 'remainder' are the trust-side tiers on the same table and the schema accepts them here too.",
      },
      {
        key: "percentage",
        label: "Percent",
        kind: "percent",
        required: true,
        range: { min: 0, max: 100 },
        notes:
          "WHOLE NUMBER — 50 means 50%, NOT 0.5. Must be strictly greater than 0 and at most 100. Each tier that has any rows must sum to 100.",
      },
      {
        key: "familyMemberId",
        label: "Beneficiary",
        kind: "uuid",
        nullable: true,
        notes:
          "EXACTLY ONE of familyMemberId / externalBeneficiaryId / entityIdRef / householdRole must be set on a row. Must belong to this client.",
      },
      {
        key: "externalBeneficiaryId",
        label: "Beneficiary",
        kind: "uuid",
        nullable: true,
        notes:
          "A charity or named outside individual. Created on the Profile tab, not here. Must belong to this client.",
      },
      {
        key: "entityIdRef",
        label: "Beneficiary",
        kind: "uuid",
        nullable: true,
        notes: "Names a trust as the beneficiary. Must belong to this client.",
      },
      {
        key: "householdRole",
        label: "Beneficiary",
        kind: "enum",
        enumValues: ["client", "spouse"],
        nullable: true,
        notes: "Names the household principal directly rather than by family-member id.",
      },
      {
        key: "sortOrder",
        label: "Beneficiary row order",
        kind: "number",
        defaultValue: 0,
        notes: "Integer, non-negative. Falls back to the array index when omitted.",
      },
      {
        key: "distributionForm",
        label: "Distribution form",
        kind: "enum",
        enumValues: ["in_trust", "outright"],
        writable: false,
        notes:
          "Accepted by the shared schema (and defaulted to 'outright' on a remainder row) but the ACCOUNT beneficiaries route never inserts it — the column stays NULL for account designations. Only the trust-side surfaces persist it.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Business per-year flow schedule.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "account_flow_override",
    payloadShape: { wrappedIn: "overrides" },
    label: "Flow schedule (per year)",
    tab: "net-worth",
    surface: "Net Worth → Business → Flows → Schedule",
    table: "accountFlowOverrides",
    routes: {
      list: "/accounts/[accountId]/flow-overrides",
      update: "/accounts/[accountId]/flow-overrides",
    },
    createSchema: { module: "@/lib/schemas/flow-overrides", export: "flowOverrideBulkSchema" },
    scenarioScoped: true,
    fields: [
      {
        key: "year",
        label: "Year (Age)",
        kind: "year",
        required: true,
        notes: "Per row inside `overrides`. Any integer — the route sets no min or max.",
      },
      {
        key: "incomeAmount",
        label: "Income",
        kind: "money",
        nullable: true,
        notes: "Per row. JSON number or null; NULL means 'no override for this year'.",
      },
      {
        key: "expenseAmount",
        label: "Expense",
        kind: "money",
        nullable: true,
        notes: "Per row. JSON number or null.",
      },
      {
        key: "distributionPercent",
        label: "Distribution %",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Per row. Decimal FRACTION — the grid's '100%' button writes 1, not 100.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Annuity contract — a 1:1 extension on an `annuity` account.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "annuity_contract",
    label: "Income & Guarantees",
    tab: "net-worth",
    surface: "Net Worth → annuity account → Income & Guarantees",
    table: "annuityContracts",
    routes: {
      list: "/annuity-contracts/[accountId]",
      update: "/annuity-contracts/[accountId]",
    },
    createSchema: { module: "@/lib/schemas/annuities", export: "annuityContractSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "carrier",
        label: "Carrier",
        kind: "string",
        nullable: true,
        range: { max: 200 },
        notes:
          "Accepted and stored, but the Income & Guarantees panel no longer edits it — it round-trips whatever is already on the row. Nothing in the engine reads it.",
      },
      {
        key: "contractNumberLast4",
        label: "Contract number (last 4)",
        kind: "string",
        nullable: true,
        range: { max: 4 },
        notes: "Accepted and stored but not edited on screen (see carrier).",
      },
      {
        key: "productType",
        label: "Product type",
        kind: "enum",
        enumValues: ["spia", "dia", "myga", "fixed", "fixed_indexed", "variable", "qlac"],
        defaultValue: "fixed",
        notes:
          "'qlac' triggers a soft warning (never a rejection) when the account's value exceeds the 2026 QLAC premium cap of $210,000; the response carries it in `warnings`.",
      },
      {
        key: "taxTreatment",
        label: "How it's taxed",
        kind: "enum",
        enumValues: ["qualified", "non_qualified", "tax_free"],
        defaultValue: "non_qualified",
        writable: false,
        notes:
          "READ-ONLY in practice: the route overwrites whatever you send with the account's sub-type, because an annuity's Account Type IS its tax treatment (identical spellings). Change it by setting accounts.subType instead. The body value only survives on a legacy row whose sub-type is still 'other'.",
      },
      {
        key: "costBasis",
        label: "Cost basis",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes:
          "Investment in the contract (§72 basis) — already-taxed money the client put in. '' / null / absent all mean UNKNOWN, never 0: a 0 here would make the whole contract taxable, and NULL makes the engine treat basis as equal to value at plan start. Only meaningful for a non-qualified contract.",
      },
      {
        key: "surrenderChargePct",
        label: "Surrender charge",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal fraction. Accepted and stored but not edited on screen.",
      },
      {
        key: "surrenderEndYear",
        label: "Surrender period ends",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
        notes: "Accepted and stored but not edited on screen.",
      },
      {
        key: "annualFeePct",
        label: "Annual contract fee",
        kind: "rate",
        defaultValue: 0,
        range: { min: 0, max: 1 },
        notes:
          "Decimal fraction. NOT nullable — an explicit null is a 400; an empty string or an absent key falls back to 0.",
      },
      {
        key: "incomeMode",
        label: "Income mode",
        kind: "enum",
        enumValues: ["none", "rider", "annuitized"],
        defaultValue: "none",
        notes:
          "'none' = Not taking income yet. 'rider' = a guaranteed lifetime payment off the benefit base; the account value survives. 'annuitized' = irreversible; the balance goes to zero. 'rider' requires benefitBase; 'annuitized' requires annuitizedPayment ABOVE ZERO; anything but 'none' requires incomeStartYear or incomeStartYearRef. All three mirror DB CHECK constraints.",
      },
      {
        key: "incomeStartYear",
        label: "Income starts",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "incomeStartYearRef",
        label: "Income starts",
        kind: "enum",
        enumValues: YEAR_REFS,
        nullable: true,
        notes: "Milestone anchor instead of a fixed year.",
      },
      {
        key: "payoutStructure",
        label: "Payout structure",
        kind: "enum",
        enumValues: [
          "single_life",
          "joint_survivor",
          "life_with_period_certain",
          "period_certain",
          "cash_refund",
        ],
        nullable: true,
        notes:
          "Read for a rider as well as an annuitized contract — without it a joint rider stops paying at the first death.",
      },
      {
        key: "survivorPct",
        label: "Survivor share",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes:
          "Decimal fraction — 1 keeps the payment unchanged for the survivor. Only shown for 'joint_survivor'. Not schema-required, but left blank the survivor is paid nothing.",
      },
      {
        key: "periodCertainYears",
        label: "Guaranteed years",
        kind: "number",
        nullable: true,
        range: { min: 0, max: 120 },
        notes: "Integer. Shown for the period-certain payout structures.",
      },
      {
        key: "benefitBase",
        label: "Benefit base",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes:
          "Required when incomeMode is 'rider'. A phantom figure used ONLY to compute the rider income — it is never withdrawable.",
      },
      {
        key: "rollupRate",
        label: "Roll-up rate",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal fraction. Guaranteed annual growth of the benefit base.",
      },
      {
        key: "rollupEndYear",
        label: "Roll-up runs through",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "rollupRatchets",
        label: "Steps up with the market",
        kind: "boolean",
        defaultValue: true,
        notes:
          "When the account beats the guarantee, the benefit base locks in at the higher balance. Off means only the guaranteed rate ever applies.",
      },
      {
        key: "riderFeePct",
        label: "Rider fee",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
      },
      {
        key: "payoutPct",
        label: "Payout rate",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal fraction. NULL = derive from the engine's age-band table.",
      },
      {
        key: "annuitizedPayment",
        label: "Annual payment",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes:
          "Required and strictly ABOVE ZERO when incomeMode is 'annuitized' — a 0 passes every null check in the stack and would surrender the whole balance for nothing.",
      },
      {
        key: "expectedReturnYears",
        label: "Expected payout years",
        kind: "number",
        nullable: true,
        range: { min: 0, max: 120 },
        notes:
          "Years the tax-free portion is spread over (§72 expected-return multiple). NOT a fraction. NULL = use the IRS life-expectancy table. Column is numeric(6,2).",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Stock options.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "stock_option_account",
    label: "Stock Options account",
    tab: "net-worth",
    surface: "Net Worth → + Add Asset → Stock Options → Account Details",
    table: "stockOptionAccounts",
    routes: {
      list: "/stock-option-accounts",
      create: "/stock-option-accounts",
      update: "/stock-option-accounts/[accountId]",
      delete: "/stock-option-accounts/[accountId]",
    },
    createSchema: { module: "@/lib/schemas/stock-options", export: "stockOptionAccountCreateSchema" },
    scenarioScoped: true,
    fields: [
      {
        key: "name",
        label: "Account Name",
        kind: "string",
        required: true,
        range: { min: 1, max: 200 },
        notes: "Written to the accounts row, which the POST also creates (category 'stock_options', sub-type 'other').",
      },
      {
        key: "owner",
        label: "Owner(s)",
        kind: "enum",
        enumValues: ["client", "spouse"],
        required: true,
        notes:
          "Single-owner model — becomes one account_owners row at 100%. If the named family member does not exist the account is left ownerless rather than mis-assigned.",
      },
      {
        key: "growthRate",
        label: "Growth Rate",
        kind: "rate",
        nullable: true,
        notes: "Decimal fraction, written to the accounts row. Omit to inherit the plan default.",
      },
      {
        key: "ticker",
        label: "Ticker Symbol",
        kind: "string",
        nullable: true,
        range: { max: 20 },
      },
      {
        key: "isPublic",
        label: "Publicly traded",
        kind: "boolean",
        defaultValue: false,
      },
      {
        key: "pricePerShare",
        label: "Price Per Share ($)",
        kind: "number",
        defaultValue: 0,
        range: { min: 0 },
        notes: "Current FMV per share — the pulled quote when public, the manual 409A figure when private.",
      },
      {
        key: "destinationAccountId",
        label: "Destination account",
        kind: "uuid",
        nullable: true,
        notes:
          "Where vested / exercised-and-held shares land. Must belong to THIS client. Not exposed as a control in the account dialog.",
      },
      {
        key: "autoCreateDestination",
        label: "Auto-create destination account",
        kind: "boolean",
        defaultValue: true,
        notes:
          "With a null destinationAccountId, the engine auto-creates a per-ticker brokerage account on first acquisition. Not exposed as a control in the account dialog.",
      },
      {
        key: "sellToCover",
        label: "Sell to cover taxes",
        kind: "boolean",
        defaultValue: true,
      },
      {
        key: "withholdingRate",
        label: "Withholding Rate (%)",
        kind: "rate",
        defaultValue: 0.22,
        range: { min: 0, max: 1 },
        notes: "Decimal FRACTION despite the on-screen '%' — 0.22 is the default 22%.",
      },
      {
        key: "defaultExerciseTiming",
        label: "Default Exercise Timing",
        kind: "enum",
        enumValues: EXERCISE_TIMINGS,
        defaultValue: "at_vest",
        notes:
          "'specific_year' REQUIRES defaultExerciseYear — the schema rejects the pair apart, because a blank companion used to fall through to a default that inverted the strategy. 'manual' defers to planned events, which no screen creates.",
      },
      {
        key: "defaultExerciseYear",
        label: "Exercise Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "defaultSellTiming",
        label: "Default Sell Timing",
        kind: "enum",
        enumValues: SELL_TIMINGS,
        defaultValue: "hold",
        notes:
          "'hold_then_sell_year' REQUIRES defaultSellYear; 'percent_per_year' REQUIRES defaultSellPercentPerYear above zero.",
      },
      {
        key: "defaultSellYear",
        label: "Sell Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "defaultSellPercentPerYear",
        label: "Sell % Per Year",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal FRACTION despite the on-screen '%'. Must be above 0 when sell timing is percent-per-year.",
      },
      {
        key: "defaultSellStartYear",
        label: "Start Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
        notes: "Deliberately NOT required — blank falls back to the acquisition year.",
      },
    ],
  },

  {
    id: "stock_option_grant",
    label: "Grant",
    tab: "net-worth",
    surface: "Net Worth → stock-option account → Grants",
    table: "stockOptionGrants",
    routes: {
      list: "/stock-option-accounts/[accountId]/grants",
      create: "/stock-option-accounts/[accountId]/grants",
      update: "/stock-option-accounts/[accountId]/grants/[grantId]",
      delete: "/stock-option-accounts/[accountId]/grants/[grantId]",
    },
    createSchema: { module: "@/lib/schemas/stock-options", export: "grantCreateSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "grantType",
        label: "Grant Type",
        kind: "enum",
        enumValues: ["rsu", "nqso", "iso"],
        required: true,
      },
      {
        key: "grantDate",
        label: "Grant Date",
        kind: "date",
        required: true,
        notes: "ISO 8601 (YYYY-MM-DD). No tranche may be acquired before it.",
      },
      {
        key: "sharesGranted",
        label: "Shares Granted",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes:
          "Must equal the sum of the tranches' `shares` within 1e-6 whenever any tranche is present — the projection is built from the tranches, not from this figure.",
      },
      {
        key: "grantNumber",
        label: "Grant Number (optional)",
        kind: "string",
        nullable: true,
        range: { max: 100 },
      },
      {
        key: "has83bElection",
        label: "83(b) Election filed",
        kind: "boolean",
        defaultValue: false,
        notes:
          "RSU only on screen. When true, fmvAtGrant becomes required — and an RSU with an 83(b) is the one case where a grant may carry zero tranches.",
      },
      {
        key: "fmvAtGrant",
        label: "FMV at Grant",
        kind: "number",
        nullable: true,
        range: { min: 0 },
        notes: "Per-share fair market value at grant. Required when has83bElection is true.",
      },
      {
        key: "strikePrice",
        label: "Strike Price",
        kind: "number",
        nullable: true,
        range: { min: 0 },
        notes: "NQSO / ISO: at least one of strikePrice or strikeDiscountPct is required.",
      },
      {
        key: "strikeDiscountPct",
        label: "Strike Discount %",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes:
          "Decimal FRACTION (0.15 = 15%) even though the input is typed in whole percent on screen. A percentage off FMV in the exercise year.",
      },
      {
        key: "expirationDate",
        label: "Expiration Date",
        kind: "date",
        nullable: true,
        notes: "ISO 8601. REQUIRED for nqso / iso grants.",
      },
      {
        key: "exerciseTiming",
        label: "Exercise Timing",
        kind: "enum",
        enumValues: EXERCISE_TIMINGS,
        nullable: true,
        notes:
          "Grant-level override; NULL inherits the account default. 'specific_year' requires exerciseYear on the same payload.",
      },
      {
        key: "exerciseYear",
        label: "Exercise Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "sellTiming",
        label: "Sell Timing",
        kind: "enum",
        enumValues: SELL_TIMINGS,
        nullable: true,
        notes:
          "Grant-level override; NULL inherits. 'hold_then_sell_year' requires sellYear; 'percent_per_year' requires sellPercentPerYear above zero.",
      },
      {
        key: "sellYear",
        label: "Sell Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "sellPercentPerYear",
        label: "Sell % Per Year",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal FRACTION.",
      },
      {
        key: "sellStartYear",
        label: "Sell Start Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
        notes: "Blank falls back to the acquisition year.",
      },
      {
        key: "notes",
        label: "Notes (optional)",
        kind: "text",
        nullable: true,
        range: { max: 2000 },
      },
      {
        key: "tranches",
        label: "Vesting Schedule",
        kind: "array",
        notes:
          "Defaults to []. At least one row is required UNLESS the grant is an RSU with an 83(b) election. Rows are written whole on create and replaced whole on update — send the full schedule. Shares must total sharesGranted. See the stock_option_vest_tranche entity for the row shape.",
      },
      {
        key: "plannedEvents",
        label: "Planned events",
        kind: "array",
        notes:
          "Defaults to [] on CREATE. On UPDATE an ABSENT key means 'leave the stored events alone' — sending [] deletes them all, which used to silently abandon every grant on 'manual' timing. See the stock_option_planned_event entity.",
      },
    ],
  },

  {
    id: "stock_option_vest_tranche",
    nestedIn: { entity: "stock_option_grant", key: "tranches" },
    label: "Vesting Schedule row",
    tab: "net-worth",
    surface: "Net Worth → stock-option account → Grants → Vesting Schedule",
    table: "stockOptionVestTranches",
    routes: {
      create: "/stock-option-accounts/[accountId]/grants",
      update: "/stock-option-accounts/[accountId]/grants/[grantId]",
    },
    createSchema: { module: "@/lib/schemas/stock-options", export: "grantCreateSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "vestDate",
        label: "Vest Date",
        kind: "date",
        required: true,
        notes: "ISO 8601 (YYYY-MM-DD).",
      },
      {
        key: "shares",
        label: "Shares",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes: "The tranche totals across a grant must equal the grant's sharesGranted.",
      },
      {
        key: "sharesExercised",
        label: "Exercised",
        kind: "number",
        defaultValue: 0,
        range: { min: 0 },
        notes:
          "Actuals already exercised. Cannot exceed the row's `shares` on an NQSO / ISO. Not shown for RSU grants.",
      },
      {
        key: "sharesSold",
        label: "Sold",
        kind: "number",
        defaultValue: 0,
        range: { min: 0 },
        notes:
          "Actuals already sold. Cannot exceed `shares` on an RSU, or `sharesExercised` on an NQSO / ISO — shares flow vested → exercised → sold.",
      },
      {
        key: "acquiredOn",
        label: "Acquired",
        kind: "date",
        nullable: true,
        notes:
          "The REAL pre-plan acquisition date (exercise date for an option, vest date for an RSU). Must not be before the grant date, and the row must actually have acquired shares. NULL = unknown, and the engine then falls back conservatively (basis floored at strike, zero days held) rather than favourably.",
      },
      {
        key: "priceAtAcquisition",
        label: "Price then",
        kind: "number",
        nullable: true,
        range: { min: 0 },
        notes:
          "FMV per share on the acquisition day. Requires acquiredOn — a price with no date is rejected, because the holding period would be unanswerable.",
      },
      {
        key: "exerciseTiming",
        label: "Exercise Timing",
        kind: "enum",
        enumValues: EXERCISE_TIMINGS,
        nullable: true,
        notes: "Tranche-level override; NULL inherits the grant, then the account.",
      },
      {
        key: "exerciseYear",
        label: "Exercise Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "sellTiming",
        label: "Sell Timing",
        kind: "enum",
        enumValues: SELL_TIMINGS,
        nullable: true,
        notes: "Tranche-level override; NULL inherits.",
      },
      {
        key: "sellYear",
        label: "Sell Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "sellPercentPerYear",
        label: "Sell % Per Year",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal FRACTION.",
      },
      {
        key: "sellStartYear",
        label: "Sell Start Year",
        kind: "year",
        nullable: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "sortOrder",
        label: "Vesting Schedule row order",
        kind: "number",
        writable: false,
        notes: "Assigned server-side from the array index — do not send it.",
      },
    ],
  },

  {
    id: "stock_option_planned_event",
    nestedIn: { entity: "stock_option_grant", key: "plannedEvents" },
    label: "Planned event",
    tab: "net-worth",
    surface:
      "Net Worth → stock-option account → Grants (no screen creates these — they arrive only in the grants API payload)",
    table: "stockOptionPlannedEvents",
    routes: {
      create: "/stock-option-accounts/[accountId]/grants",
      update: "/stock-option-accounts/[accountId]/grants/[grantId]",
    },
    createSchema: { module: "@/lib/schemas/stock-options", export: "grantCreateSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "year",
        label: "Year",
        kind: "year",
        required: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "action",
        label: "Action",
        kind: "enum",
        enumValues: ["exercise", "sell"],
        required: true,
      },
      {
        key: "shares",
        label: "Shares",
        kind: "number",
        nullable: true,
        range: { min: 0 },
        notes: "A share count for this event. Use this or `pct`.",
      },
      {
        key: "pct",
        label: "Percent",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal FRACTION of the position, as an alternative to `shares`.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Business account — the same `accounts` table, a stricter create schema.
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "business_account",
    label: "Business",
    tab: "net-worth",
    surface: "Net Worth → + Add Asset → Business → Details",
    table: "accounts",
    routes: {
      list: "/accounts",
      create: "/accounts",
      update: "/accounts/[accountId]",
      delete: "/accounts/[accountId]",
    },
    createSchema: {
      module: "@/lib/schemas/accounts-business",
      export: "AddBusinessInputSchema",
      // Validates only the business-specific keys; the body also carries
      // category/name/value and the rest, checked by accountCreateSchema.
      validatesSubset: true,
    },
    writeCore: "@/lib/clients/accounts-writes",
    scenarioScoped: true,
    forgeTool: { add: "add_account", update: "update_account", remove: "remove_account" },
    fields: [
      {
        key: "category",
        label: "Category",
        kind: "enum",
        enumValues: ["business"],
        required: true,
        notes:
          "Sending category 'business' switches the create path onto AddBusinessInputSchema, which is far stricter than the generic account schema.",
      },
      { key: "name", label: "Name", kind: "string", required: true },
      {
        key: "businessType",
        label: "Business type",
        kind: "enum",
        enumValues: ["sole_prop", "partnership", "s_corp", "c_corp", "llc", "other"],
        required: true,
        notes:
          "Required on a business row. Also DERIVES accounts.subType (sole_prop → sole_proprietorship, other → other); a client-supplied subType is ignored.",
      },
      {
        key: "value",
        label: "Current value",
        kind: "money",
        required: true,
        range: { min: 0 },
        notes: "Coerced from a numeric string. Must be zero or more.",
      },
      {
        key: "basis",
        label: "Cost basis",
        kind: "money",
        required: true,
        range: { min: 0 },
      },
      {
        key: "growthRate",
        label: "Growth rate",
        kind: "rate",
        nullable: true,
        notes: "Decimal fraction. Blank inherits the plan's default business growth rate.",
      },
      {
        key: "distributionPolicyPercent",
        label: "Distribution policy",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes: "Decimal FRACTION — share of annual earnings paid out to owners. Blank = no distribution.",
      },
      {
        key: "flowMode",
        label: "Annual + growth / Schedule",
        kind: "enum",
        enumValues: ["annual", "schedule"],
        defaultValue: "annual",
        notes: "'schedule' makes the engine read account_flow_overrides instead of the annual rows.",
      },
      {
        key: "businessTaxTreatment",
        label: "Tax treatment",
        kind: "enum",
        enumValues: ["qbi", "ordinary", "non_taxable"],
        defaultValue: "qbi",
        notes: "'qbi' = §199A pass-through eligible for the 20% deduction.",
      },
      {
        key: "parentAccountId",
        label: "Parent business",
        kind: "uuid",
        nullable: true,
        notes:
          "Nests this business under another business account. A top-level business (parentAccountId null) ALSO auto-provisions a system-managed child cash account named '<name> — Cash' in the same transaction; the engine routes the business's income, expenses and retained earnings through it.",
      },
      {
        key: "owners",
        label: "Owners",
        kind: "array",
        required: true,
        notes:
          "At least one row, and the percents must sum to 1.0 (±0.0001). Rows are { kind: 'family_member', familyMemberId, percent } or { kind: 'entity', entityId, percent }; percent is a decimal FRACTION and IS coerced from a string here (unlike the generic account path). See account_owner_split.",
      },
    ],
  },
];
