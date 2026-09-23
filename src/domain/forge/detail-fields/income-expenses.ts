// src/domain/forge/detail-fields/income-expenses.ts
//
// Field catalogue for the "Inflows & Outflows" Details tab
// (src/components/details-sidebar.tsx href "income-expenses").
//
// Entry point: src/app/(app)/clients/[id]/details/income-expenses/page.tsx
// Main view:   src/components/income-expenses-view.tsx (IncomeDialog, ExpenseDialog)
//   plus src/components/social-security-card.tsx / social-security-dialog.tsx
//   plus src/components/forms/savings-rule-dialog.tsx / savings-rules-list.tsx
//
// Social Security is NOT modeled as its own entity here: `SocialSecurityCard` /
// `SocialSecurityDialog` read and write ordinary `incomes` rows with
// `type: "social_security"` through the exact same /incomes routes and schema
// as every other income. Its SS-specific columns (ssBenefitMode, claimingAge,
// claimingAgeMonths, claimingAgeMode, piaMonthly) already live on the `incomes`
// entity below, each noted as SS-dialog-only. Medicare coverage is edited from
// a "Medicare" tab INSIDE that same Social Security dialog (and, on the Tax
// Analysis tab, from a standalone `MedicareSetupDialog` reusing the identical
// form) — it is its own table/route (`medicare_coverage`) with no scenario
// column, so it is listed as its own entity.
import type { DetailEntity } from "./types";
import { YEAR_REFS as YEAR_REF_VALUES } from "@/lib/milestones";

export const INCOME_EXPENSE_ENTITIES: readonly DetailEntity[] = [
  // ── Incomes ─────────────────────────────────────────────────────────────
  {
    id: "income",
    label: "Income",
    tab: "income-expenses",
    surface: "Inflows & Outflows → Income → Add/Edit Income (and, for Social Security rows, the Social Security dialog)",
    table: "incomes",
    routes: {
      list: "/incomes",
      create: "/incomes",
      update: "/incomes/[incomeId]",
      delete: "/incomes/[incomeId]",
    },
    createSchema: { module: "@/lib/schemas/incomes", export: "incomeCreateSchema" },
    writeCore: "@/lib/clients/incomes-writes",
    scenarioScoped: true,
    forgeTool: { add: "add_income", update: "update_income", remove: "remove_income" },
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "enum",
        enumValues: ["salary", "social_security", "business", "deferred", "capital_gains", "trust", "other"],
        required: true,
        notes:
          "DB enum income_type (7 values). The generic Add/Edit Income dialog's Type dropdown offers only 6 (excludes social_security — SS rows are created exclusively via SocialSecurityDialog, which hardcodes type). The zod schema only checks z.string().min(1) — an invalid value is NOT caught by validation, it fails at the DB as a raw Postgres enum error.",
      },
      { key: "name", label: "Name", kind: "string", required: true },
      {
        key: "annualAmount",
        label: "Annual Amount ($)",
        kind: "money",
        required: false,
        defaultValue: "0",
        notes: "Ignored by the engine (shown as inert) once a schedule override exists for this income.",
      },
      { key: "startYear", label: "Start Year", kind: "year", required: true, range: { min: 1900, max: 2200 } },
      { key: "endYear", label: "End Year", kind: "year", required: true, range: { min: 1900, max: 2200 } },
      {
        key: "growthRate",
        label: "Growth Rate — Custom %",
        kind: "rate",
        required: false,
        defaultValue: "0.03",
        notes:
          "Decimal fraction (0.03 = 3%). READ BY THE ENGINE ONLY WHEN growthSource = \"custom\". When growthSource = \"inflation\" this value is stored but ignored — the engine uses the plan's resolved inflation rate instead.",
      },
      {
        key: "growthSource",
        label: "Growth Rate (radio: Inflation vs Custom %)",
        kind: "enum",
        enumValues: ["custom", "inflation"],
        required: false,
        defaultValue: "custom",
        notes:
          "Any value other than the literal string \"inflation\" coerces to \"custom\" — the field can never fail validation. New incomes default to \"inflation\" in the dialog's own UI state, but the CREATE schema's default (when the key is omitted entirely) is \"custom\".",
      },
      {
        key: "owner",
        label: "Owner (pill toggle: {client first name} / {co-client first name} / Joint 50/50)",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        required: false,
        defaultValue: "client",
      },
      {
        key: "ownerEntityId",
        label: "(no on-screen control on this tab)",
        kind: "uuid",
        nullable: true,
        writable: true,
        notes:
          "NOT settable from this tab's Income dialog. Actually set from the Techniques tab's entity dialog, Flows sub-tab (src/components/forms/flows-tab.tsx), which hardcodes ownerEntityId to the entity being edited and POSTs/PUTs through this SAME /incomes route. Mutually exclusive with ownerAccountId and linkedPropertyId — DB CHECK incomes_one_owner allows at most one of the three set.",
      },
      {
        key: "ownerAccountId",
        label: "Owned by business (optional)",
        kind: "uuid",
        nullable: true,
        notes: "Only offered when the client has a business account. Mutually exclusive with ownerEntityId / linkedPropertyId.",
      },
      {
        key: "cashAccountId",
        label: "Deposits to",
        kind: "uuid",
        nullable: true,
        notes: "Null falls back to the household's (or owning entity's) default checking account.",
      },
      {
        key: "linkedPropertyId",
        label: "Linked Property",
        kind: "uuid",
        nullable: true,
        notes:
          "Only rendered, and only server-accepted, when type = \"other\" — but that check (superRefine) is on incomeCreateSchema ONLY. incomeUpdateSchema has no such guard, so an update payload can set linkedPropertyId without type=\"other\" and not be rejected by the schema (still bounded by the incomes_one_owner CHECK). When set, owner is derived from the property's ownership and the Owner pill toggle is disabled.",
      },
      {
        key: "inflationStartYear",
        label: "Amount in today's dollars (inflate from {planStartYear}) — checkbox",
        kind: "year",
        nullable: true,
        notes: "Checked → planStartYear; unchecked → null (inflate from this row's own startYear instead).",
      },
      {
        key: "startYearRef",
        label: "Start Year (milestone picker)",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: "This tab's Income dialog passes showSSRefs={false}, so the 6 client/spouse_ss_* anchors are never offered here (only the Solver/importer/SS dialog write them). A row already carrying one still round-trips correctly on read.",
      },
      {
        key: "endYearRef",
        label: "End Year (milestone picker)",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: "Same SS-anchor caveat as startYearRef.",
      },
      {
        key: "taxType",
        label: "Tax Treatment",
        kind: "enum",
        enumValues: ["earned_income", "ordinary_income", "dividends", "capital_gains", "qbi", "tax_exempt", "stcg", "muni_interest"],
        nullable: true,
        defaultValue: null,
        notes: "DB enum income_tax_type; zod only checks z.string() so an invalid value fails at the DB, not validation. Dialog pre-selects a sensible default per income type (see defaultTaxTypeFor in income-expenses-view.tsx).",
      },
      {
        key: "ssBenefitMode",
        label: "Benefit mode (radio: Estimate from Salary / Primary Insurance Amount (PIA) / Annual benefit amount / No Benefit)",
        kind: "enum",
        enumValues: ["pia_at_fra", "manual_amount", "no_benefit"],
        nullable: true,
        defaultValue: null,
        notes:
          "Stored as a free-text column (no DB enum/CHECK) — these three values are a UI convention only. Only editable via the Social Security dialog (src/components/social-security-dialog.tsx), never the generic Add/Edit Income dialog. \"Estimate from Salary\" is a 4th UI-only choice that saves as \"pia_at_fra\". Meaningful only when type = \"social_security\".",
      },
      {
        key: "claimingAge",
        label: "Claim age — Specific Age (years dropdown, 62-70)",
        kind: "number",
        nullable: true,
        defaultValue: null,
        notes: "Social Security dialog only. UI restricts the dropdown to 62-70; the schema/DB place no bound. Ignored unless claimingAgeMode = \"years\".",
      },
      {
        key: "claimingAgeMonths",
        label: "Claim age — Specific Age (months dropdown, 0-11)",
        kind: "number",
        nullable: true,
        defaultValue: 0,
        notes: "Social Security dialog only. UI restricts the dropdown to 0-11; the schema/DB place no bound.",
      },
      {
        key: "claimingAgeMode",
        label: "Claim age (radio: Full Retirement Age / At Retirement / Specific Age)",
        kind: "enum",
        enumValues: ["fra", "at_retirement", "years"],
        nullable: true,
        defaultValue: null,
        notes: "Free-text column, no DB enum. Social Security dialog only.",
      },
      {
        key: "piaMonthly",
        label: "Monthly PIA",
        kind: "money",
        nullable: true,
        defaultValue: null,
        notes: "Social Security dialog only. Read-only/derived display when Benefit mode = \"Estimate from Salary\" (estimated off the owner's salary, then committed into this field on save).",
      },
      {
        key: "survivorshipPct",
        label: "Survivor benefit %",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes:
          "One of the few fields with a server-ENFORCED range (schema rejects outside [0,1], unlike growthRate). Only rendered in the generic Income dialog (not the SS dialog) when type = \"deferred\" and owner is \"client\" or \"spouse\" (not \"joint\").",
      },
      {
        key: "survivorAnnuityQtipElectOut",
        label: "Elect out of survivor-annuity marital deduction",
        kind: "boolean",
        nullable: true,
        notes: "Same gating as survivorshipPct (type=\"deferred\", owner client/spouse). Default/null/false = deemed QTIP (no §2039 inclusion at first death); true = elect out.",
      },
      {
        key: "paymentMonth",
        label: "Paid in (month select, default \"Monthly\")",
        kind: "number",
        nullable: true,
        range: { min: 1, max: 12 },
        notes: "Presentation only — never read by src/engine. Rejected (not clamped) outside 1-12.",
      },
    ],
  },

  // ── Income schedule overrides ───────────────────────────────────────────
  {
    id: "income_schedule_override",
    label: "Income Schedule Override",
    tab: "income-expenses",
    surface: "Inflows & Outflows → Income → Add/Edit Income → Schedule tab",
    table: "incomeScheduleOverrides",
    routes: {
      list: "/incomes/[incomeId]/schedule",
      create: "/incomes/[incomeId]/schedule",
      update: "/incomes/[incomeId]/schedule",
      delete: "/incomes/[incomeId]/schedule",
    },
    scenarioScoped: true,
    fields: [
      { key: "year", label: "Year (Schedule tab row)", kind: "year", required: true },
      { key: "amount", label: "Amount (Schedule tab row)", kind: "money", required: true },
    ],
  },

  // ── Expenses ────────────────────────────────────────────────────────────
  {
    id: "expense",
    label: "Expense",
    tab: "income-expenses",
    surface: "Inflows & Outflows → Expenses → Add/Edit Expense",
    table: "expenses",
    routes: {
      list: "/expenses",
      create: "/expenses",
      update: "/expenses/[expenseId]",
      delete: "/expenses/[expenseId]",
    },
    createSchema: { module: "@/lib/schemas/expenses", export: "expenseCreateSchema" },
    writeCore: "@/lib/clients/expenses-writes",
    scenarioScoped: true,
    forgeTool: { add: "add_expense", update: "update_expense", remove: "remove_expense" },
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "enum",
        enumValues: ["living", "other", "insurance", "education"],
        required: true,
        notes:
          "DB enum expense_type (4 values); zod only checks z.string().min(1). The Type select is DISABLED (can't be changed) when the row is a seeded default living-expense row (isDefault=true) — also enforced server-side (write core 400s a type change on a default row).",
      },
      { key: "name", label: "Name", kind: "string", required: true },
      {
        key: "annualAmount",
        label: "Annual Amount ($) — relabels to \"Minimum annual spend ($)\" when absorbsRemainingCashFlow is on",
        kind: "money",
        required: false,
        defaultValue: "0",
        notes: "Ignored by the engine once a schedule override exists for this expense.",
      },
      { key: "startYear", label: "Start Year", kind: "year", required: true, range: { min: 1900, max: 2200 } },
      { key: "endYear", label: "End Year", kind: "year", required: true, range: { min: 1900, max: 2200 } },
      {
        key: "growthRate",
        label: "Growth Rate — Custom %",
        kind: "rate",
        required: false,
        defaultValue: "0.03",
        notes: "Ignored by the engine when growthSource = \"inflation\" — same interaction as incomes.growthRate.",
      },
      {
        key: "growthSource",
        label: "Growth Rate (radio: Inflation vs Custom %)",
        kind: "enum",
        enumValues: ["custom", "inflation"],
        required: false,
        defaultValue: "custom",
        notes: "Same coercion as incomes.growthSource — anything but \"inflation\" becomes \"custom\".",
      },
      {
        key: "ownerEntityId",
        label: "(no on-screen control on this tab)",
        kind: "uuid",
        nullable: true,
        writable: true,
        notes:
          "Same story as incomes.ownerEntityId — set only from the Techniques tab's entity Flows sub-tab, not from this tab's Expense dialog. Mutually exclusive with ownerAccountId (DB CHECK expenses_one_owner).",
      },
      {
        key: "ownerAccountId",
        label: "Owned by business (optional)",
        kind: "uuid",
        nullable: true,
      },
      {
        key: "cashAccountId",
        label: "(no on-screen control on this tab)",
        kind: "uuid",
        nullable: true,
        writable: true,
        notes:
          "COULD NOT FIND an on-screen control for this on any expense surface. This tab's ExpenseDialog hardcodes `cashAccountId: null` in every submit body (income-expenses-view.tsx ExpenseDialog handleSubmit) — so saving ANY expense through this dialog resets a previously-set cashAccountId back to null. Treat as effectively non-editable from this tab.",
      },
      {
        key: "inflationStartYear",
        label: "Amount in today's dollars (inflate from {planStartYear}) — checkbox",
        kind: "year",
        nullable: true,
      },
      {
        key: "startYearRef",
        label: "Start Year (milestone picker)",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: "showSSRefs={false} here too — SS anchors are never offered by this dialog's picker.",
      },
      {
        key: "endYearRef",
        label: "End Year (milestone picker)",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
      },
      {
        key: "deductionType",
        label: "Tax Treatment",
        kind: "enum",
        enumValues: ["charitable", "above_line", "below_line", "property_tax"],
        nullable: true,
        notes:
          "DB enum deduction_type; zod only checks z.string(). Field is hidden entirely (and forced to null) when type = \"living\" — living expenses are never a deduction, enforced both client-side and in the write core.",
      },
      {
        key: "endsAtMedicareEligibilityOwner",
        label: "This expense ends at Medicare eligibility (checkbox) + Client/Co-client select",
        kind: "enum",
        enumValues: ["client", "spouse"],
        nullable: true,
        notes: "null = doesn't auto-end. Set = engine zeros this expense from that owner's Medicare enrollment year onward.",
      },
      {
        key: "payShortfallOutOfPocket",
        label: "Pay shortfall out of pocket",
        kind: "boolean",
        required: false,
        defaultValue: false,
        notes: "Only rendered (and only sent as its real value) for type = \"education\"; the dialog forces false for every other type regardless of a stale prior value.",
      },
      {
        key: "isGoal",
        label: "Show as a goal",
        kind: "boolean",
        required: false,
        defaultValue: false,
        notes: "Forced true (checkbox disabled) for type = \"education\" — education rows are always goals.",
      },
      {
        key: "absorbsRemainingCashFlow",
        label: "Spend whatever's left each year",
        kind: "boolean",
        required: false,
        defaultValue: false,
        notes:
          "Only offered when type=\"living\" AND the row is not shaped like the seeded retirement living-expense row (isRetirementLivingExpense check against the plan's start year). Write core also enforces at most one absorbing row per (client, scenario) and 400s a retirement-shaped row even if the client bypasses the UI. When on, annualAmount's label becomes \"Minimum annual spend ($)\" (a floor, not the answer).",
      },
      {
        key: "institutionState",
        label: "Institution State",
        kind: "string",
        nullable: true,
        notes: "Education only (StateSelect). Free-text label, no cost-lookup.",
      },
      {
        key: "institutionName",
        label: "Institution Name",
        kind: "string",
        nullable: true,
        notes: "Education only.",
      },
      {
        key: "forFamilyMemberId",
        label: "For",
        kind: "uuid",
        nullable: true,
        notes: "Education only. Picking a beneficiary auto-sets Name (\"{first} - Education\") and re-frames Start/End Year to a 4-year programme off their birth year.",
      },
      {
        key: "dedicatedAccountIds",
        label: "Dedicated Funding (checkbox list)",
        kind: "array",
        required: false,
        defaultValue: null,
        notes:
          "Education only. Array of account uuids, order = draw order = the account's sortOrder in the expense_dedicated_accounts join table — there is no separate route for that table; it is written entirely through this field on the expense payload. Duplicates are silently deduped server-side (dedupeDedicatedIds).",
      },
      {
        key: "paymentMonth",
        label: "Paid in (month select, default \"Monthly\")",
        kind: "number",
        nullable: true,
        range: { min: 1, max: 12 },
        notes: "Presentation only — never read by src/engine.",
      },
      {
        key: "isDefault",
        label: "(shown as a disabled Type select + explanatory caption on seeded rows)",
        kind: "boolean",
        writable: false,
        notes:
          "Marks the auto-seeded current/retirement living-expense rows every client gets. Not itself settable — the write core rejects a type change or a delete on any row where this is true (\"Default living-expense rows cannot change type / cannot be deleted.\").",
      },
    ],
  },

  // ── Expense schedule overrides ──────────────────────────────────────────
  {
    id: "expense_schedule_override",
    label: "Expense Schedule Override",
    tab: "income-expenses",
    surface: "Inflows & Outflows → Expenses → Add/Edit Expense → Schedule tab",
    table: "expenseScheduleOverrides",
    routes: {
      list: "/expenses/[expenseId]/schedule",
      create: "/expenses/[expenseId]/schedule",
      update: "/expenses/[expenseId]/schedule",
      delete: "/expenses/[expenseId]/schedule",
    },
    scenarioScoped: true,
    fields: [
      { key: "year", label: "Year (Schedule tab row)", kind: "year", required: true },
      { key: "amount", label: "Amount (Schedule tab row)", kind: "money", required: true },
    ],
  },

  // ── Savings rules ───────────────────────────────────────────────────────

  // ── Savings schedule overrides ──────────────────────────────────────────

  // ── Medicare coverage ───────────────────────────────────────────────────
  {
    id: "medicare_coverage",
    label: "Medicare Coverage",
    tab: "income-expenses",
    surface:
      "Inflows & Outflows → Social Security → Edit Social Security → Medicare tab (also reachable, with the identical form, from the Tax Analysis tab's \"Set up Medicare modeling\" empty-state CTA)",
    table: "medicareCoverage",
    routes: {
      list: "/medicare-coverage",
      create: "/medicare-coverage",
      update: "/medicare-coverage",
      // No delete route exists.
    },
    // No zod schema — validated ad hoc in the route (only `owner` is checked).
    // No shared write core either: the route calls src/lib/medicare/dbMapper.ts's
    // medicareCoverageToInsert() directly and upserts inline.
    scenarioScoped: false,
    fields: [
      {
        key: "owner",
        label: "(implicit — determined by which person's Social Security dialog is open, or the Client/Co-client toggle in the standalone setup dialog)",
        kind: "enum",
        enumValues: ["client", "spouse"],
        required: true,
        notes:
          "Route 400s anything other than \"client\"/\"spouse\" even though the underlying column is the shared ownerEnum (which also allows \"joint\"). Primary key is (clientId, owner) via a unique index — PUT is a full upsert keyed on this pair, so on this tab there is no separate create vs. update call, just one PUT.",
      },
      {
        key: "enrollmentYear",
        label: "Enrollment year",
        kind: "year",
        nullable: true,
        notes: "Null = engine uses the year the person turns 65. The dialog pre-fills birthYear+65 client-side only; the column itself has no DB default.",
      },
      {
        key: "coverageType",
        label: "Coverage type",
        kind: "enum",
        enumValues: ["original", "advantage"],
        required: false,
        defaultValue: "original",
        notes: "DB column default is \"original\". COULD NOT CONFIRM whether omitting this key on a PUT to an EXISTING row preserves its stored value or resets it — the dialog always sends a value in practice, so this path is untested.",
      },
      {
        key: "medigapMonthlyAt65",
        label: "Medigap monthly ($)",
        kind: "money",
        nullable: true,
        notes: "UI placeholder suggests ~$170 (DEFAULT_MEDIGAP_MONTHLY_AT_BASE_YEAR) but that is a client-side pre-fill only, not a server default — omitted/cleared saves null.",
      },
      {
        key: "partDPlanMonthlyAt65",
        label: "Part D plan monthly ($)",
        kind: "money",
        nullable: true,
        notes: "UI placeholder suggests ~$46 (DEFAULT_PART_D_PLAN_MONTHLY_AT_BASE_YEAR); same no-server-default caveat as medigapMonthlyAt65.",
      },
      {
        key: "priorYearMagi",
        label: "Prior-year MAGI ($, optional)",
        kind: "money",
        nullable: true,
        notes: "For joint filers the UI instructs entering the SAME household MAGI on both spouses' rows — IRMAA reads the household figure, not a per-person split.",
      },
      {
        key: "estimatePriorYearMagiFromProjection",
        label: "Estimate prior-year MAGI from projection",
        kind: "boolean",
        required: false,
        defaultValue: false,
        notes: "When true, the Prior-year MAGI input is hidden and the engine estimates it from the current-year projection instead.",
      },
    ],
  },
 {
  id: "savings_rule",
  label: "Savings Rule",
  tab: "income-expenses",
  surface:
    "Net Worth → Add/Edit Account → Savings Rules tab (Add/Edit Savings Rule dialog, Details tab). Also reachable from Income & Expenses → Savings & Contributions — same dialog, same routes.",
  table: "savingsRules",
  routes: {
    list: "/savings-rules",
    create: "/savings-rules",
    update: "/savings-rules/[ruleId]",
    delete: "/savings-rules/[ruleId]",
  },
  // No exported zod schema — src/lib/clients/savings-rules-writes.ts's own
  // header comment: "There is no zod schema for savings rules; the route
  // hand-destructures." Required-ness below is read off that file's
  // `if (!p.accountId || !p.startYear || !p.endYear)` guard.
  writeCore: "@/lib/clients/savings-rules-writes",
  scenarioScoped: true,
  // No Forge tool writes this entity today.
  fields: [
    { key: "accountId", label: "Account", kind: "uuid", required: true },
    {
      key: "annualAmount",
      label: "Annual Amount ($)",
      kind: "money",
      required: false,
      defaultValue: "0",
      notes: "Ignored by the engine when annualPercent is set or contributeMax is true; the UI mode toggle (\"Dollar amount\" / \"% of salary\" / \"Max (IRS limit)\") decides which of annualAmount/annualPercent/contributeMax is meaningful.",
    },
    {
      key: "annualPercent",
      label: "Contribution (% of salary)",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "Only offered for retirement subtypes 401k/403b/other. When set, the engine resolves the contribution as ownerSalary × annualPercent each year.",
    },
    {
      key: "contributeMax",
      label: "Max (IRS limit) [mode toggle]",
      kind: "boolean",
      required: false,
      defaultValue: false,
      notes: "Only offered for subtypes with an IRS cap (401k/403b/traditional_ira/roth_ira/hsa). When true, overrides annualAmount/annualPercent with the IRS limit for the owner's age each year.",
    },
    {
      key: "rothPercent",
      label: "Roth share (Pre-tax/Roth split or \"Roth share of max\")",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "Fraction (0-1) of the resolved contribution designated Roth. Only offered for 401k/403b. UI never exposes this as one direct input — it's derived from separate Pre-tax/Roth dollar or percent inputs (or a single \"Roth share of max\" percent in Max mode) and computed before submit.",
    },
    {
      key: "isDeductible",
      label: "Contribution is tax-deductible (pre-tax)",
      kind: "boolean",
      required: false,
      defaultValue: true,
      notes: "Only shown for deductible-eligible retirement subtypes; hidden (and pinned to its existing/true value) when the Roth pre-tax/Roth split UI is shown instead.",
    },
    {
      key: "applyContributionLimit",
      label: "Apply IRS contribution limit",
      kind: "boolean",
      required: false,
      defaultValue: true,
      notes: "Only shown for subtypes with an IRS cap (401k/403b/traditional_ira/roth_ira/hsa). Unchecking lets the entered amount/percent bypass the cap entirely.",
    },
    { key: "startYear", label: "Start Year", kind: "year", required: true },
    { key: "endYear", label: "End Year", kind: "year", required: true },
    { key: "startYearRef", label: "Start Year", kind: "enum", enumValues: YEAR_REF_VALUES, required: false, nullable: true },
    { key: "endYearRef", label: "End Year", kind: "enum", enumValues: YEAR_REF_VALUES, required: false, nullable: true },
    {
      key: "growthRate",
      label: "Growth Rate (custom %)",
      kind: "rate",
      required: false,
      nullable: true,
      notes:
        "Hidden entirely in percent-of-salary contribution mode (growth has no effect there). UPDATE guards this field on `!= null` rather than `!== undefined` like every sibling column — an explicit null in the PUT body DOES clear it to \"0\" server-side; omitting the key leaves it untouched.",
    },
    {
      key: "growthSource",
      label: "Growth Rate (Inflation / Custom % toggle)",
      kind: "enum",
      enumValues: ["custom", "inflation"],
      required: false,
      defaultValue: "custom",
      notes: "Route coerces any value other than \"inflation\" to \"custom\".",
    },
    {
      key: "employerMatchPct",
      label: "Match rate (%)",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "Only shown for 401k/403b/other, and only when Employer Match mode is \"% of salary\".",
    },
    {
      key: "employerMatchCap",
      label: "Cap (% of salary) — optional",
      kind: "rate",
      required: false,
      nullable: true,
      notes: "Optional cap alongside employerMatchPct: no cap → rate × salary; with cap → rate × cap × salary.",
    },
    {
      key: "employerMatchAmount",
      label: "Flat annual amount ($)",
      kind: "money",
      required: false,
      nullable: true,
      notes: "Only shown when Employer Match mode is \"Flat $\". When set, the engine ignores employerMatchPct/employerMatchCap.",
    },
    {
      key: "salaryBasis",
      label: "Salary basis (\"All salaries\" checkbox / per-salary checkboxes)",
      kind: "enum",
      enumValues: ["owner", "all", "selected"],
      required: false,
      defaultValue: "owner",
      notes:
        "Only surfaced in the UI when a percent-of-salary contribution or percent-based employer match is in play. Write core stores \"owner\" whenever the payload says \"selected\" but salaryIncomeIds is empty (src/lib/clients/savings-rules-writes.ts's basisToStore()) — storing \"selected\" with nothing selected would leave the rule labelled one way and computed another.",
    },
    {
      key: "salaryIncomeIds",
      label: "(per-salary checkboxes, shown when Salary basis has specific salaries checked)",
      kind: "array",
      required: false,
      notes:
        "Income uuids the percent contribution AND employer match resolve against, when salaryBasis = \"selected\". Stored in a join table (savings_rule_salary_incomes, table: savingsRuleSalaryIncomes) via replaceSalaryIncomes(), not a column on savings_rules — no separate route; always sent alongside the parent create/update payload, whether or not the panel is visible (so flipping to flat-dollar mode keeps the salaries the rule was built on).",
    },
  ],
},
  {
    id: "savings_rule_schedule_override",
  label: "Savings Rule Schedule Override",
  tab: "income-expenses",
  surface: "Net Worth → Add/Edit Account → Savings Rules tab → Add/Edit Savings Rule → Schedule tab",
  table: "savingsScheduleOverrides",
  routes: {
    // One PUT replaces the ENTIRE set of override rows for a rule
    // (delete-then-reinsert); DELETE clears the whole set. There is no
    // per-row create/update/delete and no separate "create" route — PUT
    // creates the rule's first schedule too.
    list: "/savings-rules/[ruleId]/schedule",
    update: "/savings-rules/[ruleId]/schedule",
    delete: "/savings-rules/[ruleId]/schedule",
  },
  // No exported (or even inline) zod schema. The PUT handler does
  // `const overrides: { year; amount }[] = body.overrides ?? []` — a bare
  // TypeScript cast with ZERO runtime validation of shape, type, or range.
  scenarioScoped: false,
  fields: [
    {
      key: "year",
      label: "(Schedule tab year cell)",
      kind: "year",
      required: false,
      notes:
        "One row of the `overrides: [{ year, amount }]` array sent in the PUT body — the whole array replaces every existing override for the rule in one call. The route performs no runtime validation at all (see entity note); required-ness here reflects the UI's intent, not a server-enforced constraint. When present for a savings rule, overrides replace that rule's annualAmount/growthRate for the named year only — employer match still applies on top.",
    },
    {
      key: "amount",
      label: "(Schedule tab amount cell)",
      kind: "money",
      required: false,
      notes: "See `year` — part of the same unchecked array; the override contribution amount for that year.",
    },
  ],
}];
