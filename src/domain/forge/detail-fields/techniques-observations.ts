import type { DetailEntity } from "./types";
import { USPS_STATE_CODES as USPS_STATE_CODE_VALUES } from "@/lib/usps-states";
import { OBSERVATION_TOPICS as OBSERVATION_TOPIC_VALUES } from "@/lib/schemas/observations";
import { rothConversionTypeEnum } from "@/db/schema";
import { YEAR_REFS as YEAR_REF_VALUES } from "@/lib/milestones";

// Two small Details tabs in one file: Techniques (5 entities backing the
// sections in `src/components/techniques-view.tsx`) and Observations (the
// advisor-authored rows behind `src/components/observations/observations-panel.tsx`).
//
// None of the five Techniques sections are links out to the Solver or another
// tab — every one is a real data-entry route with its own table. All five
// tables (`transfers`, `reinvestments`, `relocations`, `asset_transactions`,
// `roth_conversions`) carry a `scenario_id` column, and every route resolves
// that id itself via `getBaseCaseScenarioId()` — the advisor never picks a
// scenario, so `scenarioScoped: true` means "the write always targets the
// base case," per the contract in `./types.ts`.
//
// None of the four routes below have an EXPORTED zod schema, so `createSchema`
// is omitted for all of them:
//  - transfers, reinvestments, relocations, roth-conversions validate ad hoc
//    in the route handler (no zod at all).
//  - asset-transactions DOES build a zod schema (`postBodySchema`/`putBodySchema`
//    in the route file), but it is a local `const`, never `export`ed — so it
//    can't be referenced as `{ module, export }` for pinning. The route file
//    itself is the source of truth for that entity's shape.
//
// Update/delete for all five Techniques entities hit the SAME path as
// list/create (no id path segment) — PUT carries the row id in the JSON body
// (e.g. `{ transferId, ...fields }`), DELETE carries it as a query param
// (e.g. `?transferId=...`). That's a real gotcha for whoever wires a Forge
// write off this catalogue, so it's called out here since `DetailEntityRoutes`
// has no field to encode it.
//
// No Forge tool writes any of these six entities today. `scenario-writes.ts`'s
// `propose_changes` / `revert_change` DO accept these five Techniques
// `targetKind`s (`transfer` | `reinvestment` | `relocation` | `roth_conversion`
// | `asset_transaction` are all members of `TargetKind`) — but that tool
// writes to the `scenario_changes` OVERLAY table (a what-if diff applied at
// projection time), never to the `transfers`/`reinvestments`/... tables these
// routes and this catalogue describe. It is a close, easy-to-confuse miss,
// not a match, so `forgeTool` is omitted everywhere below. `plan_observations`
// isn't even a `TargetKind` member, so the miss doesn't apply there at all —
// there's simply no observation-writing tool yet.

// ─────────────────────────────────────────────────────────────────────────
// Techniques
// ─────────────────────────────────────────────────────────────────────────

const transferEntity: DetailEntity = {
  id: "transfer",
  label: "Transfer",
  tab: "techniques",
  surface: "Techniques → Transfers → Add Transfer",
  table: "transfers",
  routes: {
    list: "/transfers",
    create: "/transfers",
    update: "/transfers",
    delete: "/transfers",
  },
  scenarioScoped: true,
  fields: [
    { key: "name", label: "Name", kind: "string", required: true },
    { key: "sourceAccountId", label: "Source account", kind: "uuid", required: true },
    { key: "targetAccountId", label: "Target account", kind: "uuid", required: true },
    {
      key: "amount",
      label: "Amount ($)",
      kind: "money",
      required: false,
      defaultValue: 0,
      notes: "Route doesn't require it despite the form marking it required — omitted writes \"0\".",
    },
    {
      key: "mode",
      label: "Mode",
      kind: "enum",
      enumValues: ["one_time", "recurring", "scheduled"],
      required: false,
      defaultValue: "one_time",
    },
    { key: "startYear", label: "Start Year", kind: "year", required: true },
    {
      key: "startYearRef",
      label: "Start Year",
      kind: "enum",
      enumValues: YEAR_REF_VALUES,
      required: false,
      nullable: true,
      notes:
        "Milestone anchor paired with startYear (e.g. client_retirement). Set when the advisor pins the year to a life event via the milestone picker instead of typing an absolute year; the two fields travel together.",
    },
    {
      key: "endYear",
      label: "End Year",
      kind: "year",
      required: false,
      nullable: true,
      notes: "Only meaningful for mode recurring/scheduled; the form sends null for one_time.",
    },
    {
      key: "endYearRef",
      label: "End Year",
      kind: "enum",
      enumValues: YEAR_REF_VALUES,
      required: false,
      nullable: true,
      notes: "Milestone anchor for endYear — same pairing as startYearRef.",
    },
    {
      key: "growthRate",
      label: "Growth rate (% / yr)",
      kind: "rate",
      required: false,
      defaultValue: 0,
      notes: "Only shown/used for mode = recurring; the form sends 0 for one_time and scheduled.",
    },
    {
      key: "schedules",
      label: "Schedule",
      kind: "array",
      required: false,
      notes:
        "Only used for mode = scheduled. Array of { year: number, amount: money } rows written to the separate transfer_schedules table (table: transferSchedules) via the same POST/PUT body. On PUT, sending schedules replaces the full set (delete-then-reinsert); omitting the key leaves existing rows untouched.",
    },
  ],
};

const reinvestmentEntity: DetailEntity = {
  id: "reinvestment",
  label: "Reinvestment",
  tab: "techniques",
  surface: "Techniques → Reinvestments → Add Reinvestment",
  table: "reinvestments",
  routes: {
    list: "/reinvestments",
    create: "/reinvestments",
    update: "/reinvestments",
    delete: "/reinvestments",
  },
  scenarioScoped: true,
  fields: [
    { key: "name", label: "Name", kind: "string", required: true },
    { key: "year", label: "Year", kind: "year", required: true },
    {
      key: "yearRef",
      label: "Year",
      kind: "enum",
      enumValues: YEAR_REF_VALUES,
      required: false,
      nullable: true,
      notes: "Milestone anchor paired with year (see transfer.startYearRef for the pattern).",
    },
    {
      key: "targetType",
      label: "Target",
      kind: "enum",
      enumValues: ["model_portfolio", "custom"],
      required: false,
      defaultValue: "model_portfolio",
    },
    {
      key: "modelPortfolioId",
      label: "Model portfolio",
      kind: "uuid",
      required: false,
      nullable: true,
      notes:
        "Required by the route ONLY when the request body's targetType is the literal string \"model_portfolio\" — omitting targetType entirely skips that check even though the row still defaults to target_type = model_portfolio. Send targetType explicitly when supplying a model portfolio target.",
    },
    {
      key: "customGrowthRate",
      label: "Growth rate (% / yr)",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "Required by the route only when targetType is explicitly \"custom\" in the body.",
    },
    {
      key: "customPctOrdinaryIncome",
      label: "Ordinary income",
      kind: "rate",
      required: false,
      nullable: true,
      notes:
        "Realization split, shown only for targetType = custom. Optional, but if any of the four custom-percent fields is set, all four must be present and sum to 1 (100%) — enforced client-side only, not by the route.",
    },
    {
      key: "customPctLtCapitalGains",
      label: "LT capital gains",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "See customPctOrdinaryIncome — part of the same four-way realization split.",
    },
    {
      key: "customPctQualifiedDividends",
      label: "Qualified dividends",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "See customPctOrdinaryIncome — part of the same four-way realization split.",
    },
    {
      key: "customPctTaxExempt",
      label: "Tax-exempt",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "See customPctOrdinaryIncome — part of the same four-way realization split.",
    },
    {
      key: "realizeTaxesOnSwitch",
      label: "Apply taxes on switch",
      kind: "boolean",
      required: false,
      defaultValue: false,
    },
    {
      key: "accountIds",
      label: "Target accounts (Individual assets)",
      kind: "array",
      required: false,
      notes:
        "At least one of accountIds or groupKeys must be non-empty (route-enforced). Stored via the reinvestment_accounts join table (reinvestmentAccounts), not a column on this row.",
    },
    {
      key: "groupKeys",
      label: "Target accounts (Groups)",
      kind: "array",
      required: false,
      notes:
        "Default account-group keys (e.g. \"all-liquid\") or a custom group's uuid. Stored via the reinvestment_groups join table (reinvestmentGroups). See accountIds for the at-least-one-of requirement.",
    },
  ],
};

const relocationEntity: DetailEntity = {
  id: "relocation",
  label: "Relocation",
  tab: "techniques",
  surface: "Techniques → Relocation → Add Relocation",
  table: "relocations",
  routes: {
    list: "/relocations",
    create: "/relocations",
    update: "/relocations",
    delete: "/relocations",
  },
  scenarioScoped: true,
  fields: [
    { key: "name", label: "Name", kind: "string", required: true },
    {
      key: "year",
      label: "Year",
      kind: "year",
      required: true,
      range: { min: 1900, max: 2200 },
      notes: "Route-enforced bound is 1900–2200; the form's number-input spinner only offers 2000–2100.",
    },
    {
      key: "destinationState",
      label: "Destination state",
      kind: "enum",
      enumValues: USPS_STATE_CODE_VALUES,
      required: true,
    },
  ],
};

const ASSET_CATEGORY_VALUES = [
  "taxable",
  "cash",
  "retirement",
  "real_estate",
  "business",
  "life_insurance",
  "notes_receivable",
  "education_savings",
] as const;

const ASSET_SUB_TYPE_VALUES = [
  "brokerage", "savings", "checking",
  "traditional_ira", "roth_ira", "401k", "403b", "529", "trust", "other",
  "primary_residence", "rental_property", "commercial_property",
  "sole_proprietorship", "partnership", "s_corp", "c_corp", "llc",
  "term", "whole_life", "universal_life", "variable_life",
] as const;

const assetTransactionEntity: DetailEntity = {
  id: "asset_transaction",
  label: "Asset Transaction",
  tab: "techniques",
  surface: "Techniques → Asset Transactions → Add Transaction",
  table: "assetTransactions",
  routes: {
    list: "/asset-transactions",
    create: "/asset-transactions",
    update: "/asset-transactions",
    delete: "/asset-transactions",
  },
  scenarioScoped: true,
  fields: [
    { key: "name", label: "Name", kind: "string", required: true },
    {
      key: "type",
      label: "Transaction type",
      kind: "enum",
      enumValues: ["buy", "sell"],
      required: true,
      notes:
        "Not a literal dropdown on screen — implied by whether the advisor is editing a Sell leg or a Buy leg. The route's local (unexported) zod schema requires exactly one of {accountId, purchaseTransactionId, businessAccountId} when type=sell — also enforced by the DB CHECK asset_transactions_sell_source_check — and rejects any sell-side field when type=buy.",
    },
    { key: "year", label: "Year", kind: "year", required: true },
    {
      key: "accountId",
      label: "Account to Sell",
      kind: "uuid",
      required: false,
      nullable: true,
      notes: "Sell-only; mutually exclusive with purchaseTransactionId and businessAccountId — exactly one must be set for a sell.",
    },
    {
      key: "purchaseTransactionId",
      label: "Account to Sell (Bought via transaction)",
      kind: "uuid",
      required: false,
      nullable: true,
      notes:
        "Sell-only. Sources the sell from an earlier buy leg (same client + scenario) instead of an existing account; that buy's year must be strictly before this sell's year (route-enforced).",
    },
    {
      key: "businessAccountId",
      label: "Business to Sell",
      kind: "uuid",
      required: false,
      nullable: true,
      notes: "Sell-only. Must reference an account with category = business (route-checked).",
    },
    {
      key: "fractionSold",
      label: "Sell amount (% of asset)",
      kind: "rate",
      required: false,
      nullable: true,
      range: { min: 0, max: 1 },
      notes:
        "Zod bound is (0, 1] — 0 itself is rejected. Set only when Sell amount mode is \"% of asset\"; null means a full sale, or, in \"$ amount\" mode, overrideSaleValue carries the dollar figure instead.",
    },
    {
      key: "overrideSaleValue",
      label: "Sale value ($)",
      kind: "money",
      required: false,
      nullable: true,
      notes:
        "Reads \"Amount to sell ($)\" on screen when Sell amount mode is \"$ amount\". Left blank (null) to use the projected beginning-of-year account value for accountId sells.",
    },
    {
      key: "overrideBasis",
      label: "Basis ($)",
      kind: "money",
      required: false,
      nullable: true,
      notes: "Sell-side basis. Pre-filled from the projection's basis-BoY figure; left blank (null) to use that projected value.",
    },
    { key: "transactionCostPct", label: "Transaction Cost (%)", kind: "rate", required: false, nullable: true },
    { key: "transactionCostFlat", label: "Transaction Cost ($)", kind: "money", required: false, nullable: true },
    {
      key: "proceedsAccountId",
      label: "Proceeds Destination",
      kind: "uuid",
      required: false,
      nullable: true,
      notes: "Blank selects the household's default checking account — sent as null, not a real account id.",
    },
    {
      key: "qualifiesForHomeSaleExclusion",
      label: "Qualifies for home-sale gain exclusion (§121)",
      kind: "boolean",
      required: false,
      defaultValue: false,
      notes: "Only offered on screen when the sold account's category is real_estate; the form forces it false for any other sell.",
    },
    { key: "assetName", label: "Asset Name", kind: "string", required: false, nullable: true },
    {
      key: "assetCategory",
      label: "Asset Category",
      kind: "enum",
      enumValues: ASSET_CATEGORY_VALUES,
      required: false,
      nullable: true,
      notes:
        "Buy-side. Narrower than the full account_category DB enum (excludes annuity and stock_options) — the route's zod schema is the authority here, not db/schema.ts's accountCategoryEnum.",
    },
    {
      key: "assetSubType",
      label: "Sub-Type",
      kind: "enum",
      enumValues: ASSET_SUB_TYPE_VALUES,
      required: false,
      nullable: true,
      notes: "Buy-side. Options on screen are filtered to match the chosen Asset Category.",
    },
    { key: "purchasePrice", label: "Purchase Price ($)", kind: "money", required: false, nullable: true },
    { key: "growthRate", label: "Growth Rate (%)", kind: "rate", required: false, nullable: true },
    {
      key: "growthSource",
      label: "Growth source",
      kind: "enum",
      enumValues: ["default", "model_portfolio", "custom", "asset_mix", "inflation"],
      required: false,
      nullable: true,
      notes:
        "Accepted by the route but never sent by the current Techniques form — the Buy-leg editor has only a raw Growth Rate (%) input, no source picker. Left null unless a caller (e.g. Forge) sets it explicitly.",
    },
    {
      key: "modelPortfolioId",
      label: "Model portfolio",
      kind: "uuid",
      required: false,
      nullable: true,
      notes: "Accepted (and firm-scope-checked) by the route but not exposed in the current Buy-leg form; would pair with growthSource = model_portfolio.",
    },
    { key: "basis", label: "Basis ($)", kind: "money", required: false, nullable: true, notes: "Buy-side." },
    {
      key: "fundingAccountId",
      label: "Funding Source",
      kind: "uuid",
      required: false,
      nullable: true,
      notes:
        "The form offers two special non-account choices — blank (\"Withdrawal Strategy\") and \"__from_sale_proceeds__\" (\"From Sale Proceeds\") — both converted to null on the wire. A real value is an account uuid.",
    },
    {
      key: "mortgageAmount",
      label: "Amount ($)",
      kind: "money",
      required: false,
      nullable: true,
      notes: "Under the collapsible \"Mortgage / Financing\" section; null unless the advisor expands it.",
    },
    {
      key: "mortgageRate",
      label: "Rate (%)",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "Under \"Mortgage / Financing\"; null unless the advisor expands it.",
    },
    {
      key: "mortgageTermMonths",
      label: "Term (mo)",
      kind: "number",
      required: false,
      nullable: true,
      notes: "Under \"Mortgage / Financing\"; the form pre-fills 360 once expanded, but nothing is sent unless expanded.",
    },
  ],
};

const ROTH_CONVERSION_TYPE_VALUES = rothConversionTypeEnum.enumValues;

const rothConversionEntity: DetailEntity = {
  id: "roth_conversion",
  label: "Roth Conversion",
  tab: "techniques",
  surface: "Techniques → Roth Conversions → Add Roth Conversion",
  table: "rothConversions",
  routes: {
    list: "/roth-conversions",
    create: "/roth-conversions",
    update: "/roth-conversions",
    delete: "/roth-conversions",
  },
  scenarioScoped: true,
  fields: [
    { key: "name", label: "Name", kind: "string", required: true },
    { key: "destinationAccountId", label: "Destination Account", kind: "uuid", required: true },
    {
      key: "sourceAccountIds",
      label: "Accounts to Convert",
      kind: "array",
      required: true,
      notes:
        "Non-empty array required. Order matters — drained top-to-bottom when a fixed_amount conversion can't be fully satisfied by the first source. Stored in the child roth_conversion_sources table (rothConversionSources) with a sortOrder column set from array position; PUT with sourceAccountIds present replaces the full set.",
    },
    {
      key: "conversionType",
      label: "Conversion Type",
      kind: "enum",
      enumValues: ROTH_CONVERSION_TYPE_VALUES,
      required: false,
      defaultValue: "fixed_amount",
    },
    {
      key: "fixedAmount",
      label: "Fixed Amount ($/yr)",
      kind: "money",
      required: false,
      defaultValue: 0,
      notes: "Only meaningful (and shown) for conversionType = fixed_amount; the route stores whatever is sent regardless of type.",
    },
    {
      key: "fillUpBracket",
      label: "Fill Up To",
      kind: "rate",
      required: false,
      nullable: true,
      notes:
        "Only meaningful for conversionType = fill_up_bracket. The form offers a fixed set of bracket rates (10/12/22/24/32/35/37%) but the column (decimal(5,4)) accepts any value; no server-side bound.",
    },
    {
      key: "irmaaCapTier",
      label: "IRMAA Cap",
      kind: "number",
      required: false,
      nullable: true,
      range: { min: 0, max: 4 },
      notes:
        "0 = stay surcharge-free, 1-4 = stay within that Medicare IRMAA tier, null = uncapped. There is no tier 5 (the top tier is unbounded above). Not validated server-side — the 0-4-or-blank range is UI-only.",
    },
    { key: "startYear", label: "Starts", kind: "year", required: true },
    {
      key: "startYearRef",
      label: "Starts",
      kind: "enum",
      enumValues: YEAR_REF_VALUES,
      required: false,
      nullable: true,
      notes: "Milestone anchor paired with startYear.",
    },
    {
      key: "endYear",
      label: "Ends",
      kind: "year",
      required: false,
      nullable: true,
      notes:
        "The form always sends endYear for conversionType in {deplete_over_period, fill_up_bracket, fixed_amount}; only full_account omits it (null).",
    },
    {
      key: "endYearRef",
      label: "Ends",
      kind: "enum",
      enumValues: YEAR_REF_VALUES,
      required: false,
      nullable: true,
      notes: "Milestone anchor paired with endYear.",
    },
    {
      key: "indexingRate",
      label: "Indexed At (% / yr)",
      kind: "rate",
      required: false,
      defaultValue: 0,
      notes: "Only shown/used for conversionType = fixed_amount; other types always send 0.",
    },
    {
      key: "inflationStartYear",
      label: "Start Indexing",
      kind: "year",
      required: false,
      nullable: true,
      notes:
        "null = \"Immediately\" (compounds from startYear). Otherwise set equal to startYear when the advisor picks \"At Start Year\" — the form never offers a year other than startYear itself.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Observations
// ─────────────────────────────────────────────────────────────────────────
//
// `plan_observations` has NO scenarioId column — one write is visible from
// every scenario, so scenarioScoped is false (unlike every Techniques entity
// above). Only the advisor-authored entry fields are catalogued here per the
// task brief: `source` (manual|ai — stamped by which code path calls create,
// never advisor-picked) and `audience` (client|advisor — accepted by the
// create schema but always sent as "client" from this Details surface, with
// no selector in the entry dialog) are deliberately excluded as non-entry
// plumbing, alongside the AI draft-run/polish/token-value routes, which are
// generation plumbing and out of scope entirely. `sourceScenarioId` is
// likewise excluded — it's stamped from an AI generation run, never advisor-
// entered.

const planObservationEntity: DetailEntity = {
  id: "plan_observation",
  label: "Observation / Next Step",
  tab: "observations",
  surface: "Observations → quick-add row, or the observation/next-step dialog",
  table: "planObservations",
  routes: {
    list: "/observations",
    create: "/observations",
    update: "/observations/[observationId]",
    delete: "/observations/[observationId]",
  },
  createSchema: { module: "@/lib/schemas/observations", export: "observationCreateSchema" },
  scenarioScoped: false,
  fields: [
    {
      key: "section",
      label: "Section",
      kind: "enum",
      enumValues: ["observation", "next_step"],
      required: true,
      notes:
        "Not a dropdown in the entry dialog — determined by which list (Observations vs Next Steps) the advisor adds into. Immutable after create; the update route never accepts it.",
    },
    {
      key: "topic",
      label: "Topic",
      kind: "enum",
      enumValues: OBSERVATION_TOPIC_VALUES,
      required: false,
      defaultValue: "general",
    },
    {
      key: "title",
      label: "Title",
      kind: "string",
      required: false,
      nullable: true,
      notes: "Only rendered in the dialog when section = next_step; observations have no title input (stays null).",
    },
    {
      key: "body",
      label: "Details",
      kind: "text",
      required: true,
      notes: "Rich text, max 8000 characters. Rendered as markdown and may contain {{token}} placeholders resolved to live plan figures at display time.",
    },
    {
      key: "owner",
      label: "Owner",
      kind: "enum",
      enumValues: ["advisor", "client", "joint"],
      required: false,
      nullable: true,
      notes: "Only rendered in the dialog for section = next_step.",
    },
    {
      key: "priority",
      label: "Priority",
      kind: "enum",
      enumValues: ["high", "medium", "low"],
      required: false,
      nullable: true,
      notes: "Only rendered in the dialog for section = next_step.",
    },
    {
      key: "targetDate",
      label: "Target date",
      kind: "date",
      required: false,
      nullable: true,
      notes: "Only rendered in the dialog for section = next_step. Must match YYYY-MM-DD.",
    },
    {
      key: "status",
        appliesTo: "update",
      label: "Status",
      kind: "enum",
      enumValues: ["open", "in_progress", "done"],
      required: false,
      defaultValue: "open",
      notes:
        "Not entered directly — the advisor clicks a status pip on a next step to cycle open → in_progress → done → open, which PATCHes { status }. Setting it to \"done\" stamps completedAt; leaving \"done\" clears completedAt.",
    },
    {
      key: "sortOrder",
      writable: false,
      label: "Order",
      kind: "number",
      required: false,
      defaultValue: 0,
      notes:
        "Not settable on create/update — the server computes it as the current max within (clientId, section) + 1. Reordering goes through a separate endpoint, PUT /observations/reorder (not represented in this entity's `routes`, which has no slot for it), which takes the full ordered id list for one section and reindexes sortOrder 0..n-1 for all of them atomically.",
    },
    {
      key: "source",
      label: "(no control — stamped by whoever writes the row)",
      kind: "enum",
      enumValues: ["manual", "ai"],
      defaultValue: "manual",
      notes:
        'Who wrote the row. Defaults to "manual", which is what the Details panel sends. ' +
        'Forge writing an observation of its own should send "ai", so the row is ' +
        "attributable instead of passing as advisor-authored.",
    },
    {
      key: "audience",
      label: "(no control — stamped by whoever writes the row)",
      kind: "enum",
      enumValues: ["client", "advisor"],
      defaultValue: "client",
      notes: 'Who the row is written for. The Details panel never sets it, so it lands as "client".',
    },
    {
      key: "sourceScenarioId",
      label: "(no control — stamped by whoever writes the row)",
      kind: "uuid",
      nullable: true,
      notes:
        "The scenario an AI next step came from. Stamped from the run that produced the " +
        "row, never from whichever scenario the advisor happens to have open.",
    },
  ],
};

export const TECHNIQUE_OBSERVATION_ENTITIES: readonly DetailEntity[] = [
  transferEntity,
  reinvestmentEntity,
  relocationEntity,
  assetTransactionEntity,
  rothConversionEntity,
  planObservationEntity,
];
