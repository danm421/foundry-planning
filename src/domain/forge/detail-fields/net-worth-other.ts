import type { DetailEntity } from "./types";
import { YEAR_REFS as YEAR_REF_VALUES } from "@/lib/milestones";

// Net Worth tab (`src/app/(app)/clients/[id]/details/net-worth/page.tsx`,
// `src/components/balance-sheet-view.tsx`) — the NON-account half. Accounts,
// holdings, allocations, beneficiaries, annuities and stock options are
// catalogued separately in `./net-worth-accounts.ts`.
//
// The "Household Map" board at `/details/map` is the SAME tab in a different
// view mode, not a separate one — `details-view-mode-toggle.tsx` toggles
// between them via `LANDING = { map: "map", detailed: "net-worth" }` and a
// `view_mode` column on the client row. Nothing net-worth-specific is
// entered ONLY on the map board; every entity below is reachable from the
// list view's dialogs.
//
// Two entities the brief that spawned this file hinted at — Transfers
// (`transfers` table, `src/components/forms/add-transfer-form.tsx`) and
// Reinvestments (`reinvestments` table, `src/components/forms/
// add-reinvestment-form.tsx`) — turned out NOT to belong here on inspection:
// both are entered exclusively from `src/components/techniques-view.tsx`
// (the Techniques tab), and are already catalogued in
// `./techniques-observations.ts` (ids "transfer" / "reinvestment"). Including
// them here too would collide on entity id and misattribute their tab.
// `src/components/forms/transfer-cash-form.tsx` / `transfer-asset-form.tsx` /
// `transfer-series-form.tsx` — despite the "transfer" name — are gift-funding
// forms that POST to `/api/clients/[id]/gifts` and `/gifts/series`; they are
// rendered from `add-trust-form.tsx` and catalogued under Profile (gifts)
// and/or Techniques (trusts), not here.
//
// Liability owners and note-receivable owners are NOT separate DetailEntity
// records: neither has its own route. Both are written transactionally
// inside their parent's create/update (liabilityOwners / noteReceivableOwners
// tables) and are modeled below as an `owners` field on the parent entity.

// ─────────────────────────────────────────────────────────────────────────
// Liabilities
// ─────────────────────────────────────────────────────────────────────────

const liabilityEntity: DetailEntity = {
  id: "liability",
  label: "Liability",
  tab: "net-worth",
  surface: "Net Worth → Liabilities → Add/Edit Liability → Details tab",
  table: "liabilities",
  routes: {
    list: "/liabilities",
    create: "/liabilities",
    update: "/liabilities/[liabilityId]",
    delete: "/liabilities/[liabilityId]",
  },
  createSchema: { module: "@/lib/schemas/liabilities", export: "liabilityCreateSchema" },
  writeCore: "@/lib/clients/liabilities-writes",
  scenarioScoped: true,
  forgeTool: { add: "add_liability", update: "update_liability", remove: "remove_liability" },
  fields: [
    { key: "name", label: "Liability Name", kind: "string", required: true },
    { key: "balance", label: "Outstanding Balance ($)", kind: "money", required: false, defaultValue: 0 },
    {
      key: "linkedPropertyId",
      label: "Linked Property",
      kind: "uuid",
      required: false,
      nullable: true,
      defaultValue: null,
      notes:
        "Real-estate account id this liability is secured against. Only offered in the dropdown when the client has real-estate accounts. The Add/Edit Liability form additionally REQUIRES this (client-side only, not server-enforced) whenever isInterestDeductible is checked — \"Mortgage liabilities must link to a real estate property.\"",
    },
    {
      key: "balanceAsOfMonth",
      label: "Balance as of (month)",
      kind: "number",
      required: false,
      nullable: true,
      defaultValue: null,
      notes: "Paired with balanceAsOfYear. Schema does not bound it to 1-12 (loose coercion); the UI's month <select> only offers valid months.",
    },
    { key: "balanceAsOfYear", label: "Balance as of (year)", kind: "year", required: false, nullable: true, defaultValue: null },
    { key: "startYear", label: "Loan Start (year)", kind: "year", required: true, range: { min: 1900, max: 2200 } },
    {
      key: "startMonth",
      label: "Loan Start (month)",
      kind: "number",
      required: false,
      defaultValue: 1,
      notes: "1-12. Schema does not bound it (loose coercion); the UI's month <select> only offers valid months.",
    },
    {
      key: "startYearRef",
      label: "Loan Start",
      kind: "enum",
      enumValues: YEAR_REF_VALUES,
      required: false,
      nullable: true,
      defaultValue: null,
      notes:
        "Milestone anchor paired with startYear (e.g. client_retirement), set via the MilestoneYearPicker instead of typing an absolute year. Unlike note_receivable's equivalent field, the liabilities schema declares this as z.unknown() — NOT validated against the YearRef enum server-side. The UI only ever sends one of these tokens or null.",
    },
    {
      key: "termMonths",
      label: "Term",
      kind: "number",
      notes:
        "CAREFUL: the liabilities DB column is nullable (schema.ts comment: \"revolving credit has no term\"), but liabilityCreateSchema pipes the coerced value through z.number(), which rejects undefined — so termMonths IS required through this create route. The Add/Edit Liability form also always sends a number (input has min=1, and falls back to 0 — not omitted — when parsing fails). A genuinely term-less (null) liability is reachable only through a different write path than this one (e.g. a direct Plaid-synced credit-card row), not through the advisor-facing Add/Edit dialog or this schema. Submitted value is the Term input × 12 when termUnit is \"annual\".",
    },
    {
      key: "termUnit",
      label: "Term (unit toggle: Years/Months)",
      kind: "enum",
      enumValues: ["annual", "monthly"],
      required: false,
      defaultValue: "annual",
      notes: "Schema is a loose z.string() default \"annual\" (not a real zod enum); the UI <select> only offers \"annual\" (labeled \"Years\") and \"monthly\" (labeled \"Months\").",
    },
    { key: "interestRate", label: "Interest Rate (%)", kind: "rate", required: false, defaultValue: 0, notes: "Decimal fraction (0.065 = 6.5%). The form divides the advisor-typed percent by 100 before sending." },
    {
      key: "monthlyPayment",
      label: "Monthly Payment ($)",
      kind: "money",
      required: false,
      defaultValue: 0,
      notes:
        "DB column allows null (comment: \"revolving credit has no scheduled payment\"), but the schema's decOrZeroOptional coerces an explicit null input to the string \"0\" rather than storing null — so this create/update route can never actually persist a null value despite the column permitting it. The \"Interest only\" checkbox is a client-side convenience that auto-solves this field from balance × rate; it is not itself a stored flag.",
    },
    {
      key: "owners",
      label: "Ownership",
      kind: "array",
      required: false,
      notes:
        "No dedicated route — written transactionally inside this entity's create/update (table: liabilityOwners). Array of { kind: \"family_member\" | \"entity\", familyMemberId?, entityId?, percent }; percent is a fraction (0-1) and must sum to 1 across the array (validated by src/lib/ownership.ts's validateOwnersShape, not by liabilityCreateSchema, which only requires an array). Mutually exclusive with parentAccountId — sending both is a 400. When omitted entirely on create, the server synthesizes a single 100% owner from ownerEntityId or the client family member (src/lib/ownership.ts's synthesizeLegacyLiabilityOwners).",
    },
    {
      key: "parentAccountId",
      label: "(set via the Ownership editor's \"sub-liability of a business\" option)",
      kind: "uuid",
      required: false,
      nullable: true,
      defaultValue: null,
      notes:
        "Makes this liability a child of a business account (ownership inherited from the business; owners[] must then be empty/omitted). Must reference an account in the same client whose category is \"business\" — checked on both create and update.",
    },
    {
      key: "ownerEntityId",
      label: "(no direct input — see notes)",
      kind: "uuid",
      required: false,
      nullable: true,
      writable: false,
      notes:
        "CAUTION — two unrelated meanings share this key name. On WRITE, liabilityCreateSchema/liabilityUpdateSchema accept an \"ownerEntityId\" used only as a legacy fallback to synthesize a single owners[] row when owners[] itself is omitted; the liabilities table has NO owner_entity_id column, so this value is never itself stored. The current Add/Edit Liability form has no input for it and always sends owners[] directly, so this legacy path is effectively dead from the UI. On READ, balance-sheet-view.tsx / net-worth-content.tsx populate an unrelated 'ownerEntityId' field on the display row by COMPUTING it from the real owners[] (engine/ownership.ts's controllingEntity()) — a derived display value, not this input. Forge should always write ownership via owners[] and never send this key.",
    },
    {
      key: "isInterestDeductible",
      label: "Interest is tax-deductible",
      kind: "boolean",
      required: false,
      defaultValue: false,
    },
    {
      key: "forgiveAtTermEnd",
      label: "Forgive remaining balance at end of term",
      kind: "boolean",
      required: false,
      defaultValue: false,
      notes: "For income-driven student-loan-style forgiveness. The UI disables this checkbox when the Term field is empty/zero (client-side only); not validated against termMonths server-side.",
    },
  ],
};

const liabilityExtraPaymentEntity: DetailEntity = {
  id: "liability_extra_payment",
  label: "Liability Extra Payment",
  tab: "net-worth",
  surface: "Net Worth → Liabilities → Add/Edit Liability → Amortization tab → \"+ add\" on a schedule year",
  table: "extraPayments",
  routes: {
    list: "/liabilities/[liabilityId]/extra-payments",
    create: "/liabilities/[liabilityId]/extra-payments",
    update: "/liabilities/[liabilityId]/extra-payments/[extraPaymentId]",
    delete: "/liabilities/[liabilityId]/extra-payments/[extraPaymentId]",
  },
  // No exported zod schema — the route hand-checks `year == null || !type ||
  // amount == null` on create and applies zero validation on update (PUT
  // strips only id/liabilityId/createdAt/updatedAt and writes the rest of the
  // body verbatim). No numeric range is enforced anywhere in this path,
  // unlike note_receivable_extra_payment's zod-backed equivalent.
  scenarioScoped: false,
  fields: [
    { key: "year", label: "(Extra column, year cell)", kind: "year", required: true, notes: "POST requires it present (`year == null` → 400); no numeric bound is enforced (contrast note_receivable_extra_payment's 1900-2200 zod bound)." },
    { key: "type", label: "Extra payment type", kind: "enum", enumValues: ["per_payment", "lump_sum"], required: true, notes: "UI <select>: \"Lump sum\" | \"Per payment\"." },
    { key: "amount", label: "Extra payment amount", kind: "money", required: true, notes: "POST requires it present (`amount == null` → 400); no nonnegative check is enforced." },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Notes Receivable
// ─────────────────────────────────────────────────────────────────────────

const noteReceivableEntity: DetailEntity = {
  id: "note_receivable",
  label: "Note Receivable",
  tab: "net-worth",
  surface: "Net Worth → Add Account (category: Notes Receivable) → Details tab",
  table: "notesReceivable",
  routes: {
    list: "/notes-receivable",
    create: "/notes-receivable",
    update: "/notes-receivable/[noteId]",
    delete: "/notes-receivable/[noteId]",
  },
  createSchema: { module: "@/lib/schemas/note-receivable", export: "noteReceivableCreateSchema" },
  scenarioScoped: true,
  fields: [
    { key: "name", label: "Name", kind: "string", required: true },
    { key: "faceValue", label: "Face value", kind: "money", required: true, range: { min: 0 }, notes: "Schema requires strictly positive (> 0)." },
    {
      key: "basis",
      label: "Cost basis",
      kind: "money",
      required: true,
      range: { min: 0 },
      notes: "UI helper text: \"Lower than face value only if this is an installment sale of an appreciated asset.\"",
    },
    {
      key: "asOfBalance",
      label: "Current balance",
      kind: "money",
      required: false,
      nullable: true,
      range: { min: 0 },
      notes: "UI helper text: \"Leave blank if the note starts on the start date below.\"",
    },
    { key: "balanceAsOfMonth", label: "Balance as-of month", kind: "number", required: false, nullable: true, range: { min: 1, max: 12 } },
    { key: "balanceAsOfYear", label: "Balance as-of year", kind: "year", required: false, nullable: true, range: { min: 1900, max: 2200 } },
    { key: "interestRate", label: "Interest rate", kind: "rate", required: true, range: { min: 0 }, notes: "Decimal fraction (0.05 = 5%)." },
    {
      key: "paymentType",
      label: "Payment type",
      kind: "enum",
      enumValues: ["amortizing", "interest_only_balloon"],
      required: true,
      notes: "UI <select>: \"Amortizing\" | \"Interest-only + balloon\".",
    },
    {
      key: "monthlyPayment",
      label: "Monthly payment",
      kind: "money",
      required: false,
      nullable: true,
      range: { min: 0 },
      notes: "UI helper text: \"Leave blank to compute from face value, rate, and term.\"",
    },
    { key: "startYear", label: "Start year", kind: "year", required: true, range: { min: 1900, max: 2200 } },
    { key: "startMonth", label: "Start month", kind: "number", required: false, defaultValue: 1, range: { min: 1, max: 12 } },
    {
      key: "startYearRef",
      label: "Start year",
      kind: "enum",
      enumValues: YEAR_REF_VALUES,
      required: false,
      nullable: true,
      notes: "Milestone anchor paired with startYear, set via the MilestoneYearPicker. Actually validated against this enum server-side (z.enum(YEAR_REFS)), unlike liability's z.unknown() equivalent.",
    },
    { key: "termMonths", label: "Term (months)", kind: "number", required: true, range: { min: 0 }, notes: "Schema requires a strictly positive integer." },
    {
      key: "linkedTrustEntityId",
      label: "(shown read-only on the balance-sheet row as \"→ <Trust name>\"; no input in the Add/Edit dialog)",
      kind: "uuid",
      required: false,
      nullable: true,
      writable: false,
      notes:
        "add-note-receivable-form.tsx tracks this in state but destructures no setter for it (`const [linkedTrustEntityId] = useState(...)`) — it can only ever carry a value the note was CREATED with (e.g. by an automated \"sell to trust\" / IDGT technique), never one the advisor sets or changes through this dialog. balance-sheet-view.tsx displays it read-only. Forge should not attempt to write this field via this entity.",
    },
    {
      key: "owners",
      label: "Ownership",
      kind: "array",
      required: true,
      notes:
        "Schema requires >= 1 entry. No dedicated route — written transactionally inside this entity's create/update (table: noteReceivableOwners). Each entry: { familyMemberId? | entityId? | externalBeneficiaryId? (exactly one required), percent } where percent is a fraction (0-1). The schema itself only bounds each percent to [0,1] — the ROUTE (not the schema) separately requires the full array's percents to sum to 1 (±0.0001), and separately validates every named owner id actually belongs to this client.",
    },
    {
      key: "extraPayments",
      label: "(Extra Payments tab rows, on create only)",
      kind: "array",
      required: false,
      notes:
        "Defaults to [] on create. Array of { year, type: \"per_payment\"|\"lump_sum\", amount }. On UPDATE (PATCH .../notes-receivable/[noteId]), this key is not part of noteReceivableUpdateSchema at all — extra payments are edited exclusively via the separate note_receivable_extra_payment entity/route below once the note exists.",
    },
  ],
};

const noteReceivableExtraPaymentEntity: DetailEntity = {
  id: "note_receivable_extra_payment",
  payloadShape: "array",
  label: "Note Receivable Extra Payment",
  tab: "net-worth",
  surface: "Net Worth → Add/Edit Account (Notes Receivable) → Extra Payments tab",
  table: "noteExtraPayments",
  routes: {
    // Bulk replace-all, not per-row CRUD: one PATCH takes the full array and
    // deletes+reinserts every row for the note. There is no list/create/
    // delete route — GET /notes-receivable does not embed these rows either;
    // the Details page loads them separately server-side via
    // src/lib/loaders/notes-receivable.ts's loadNotesReceivable().
    update: "/notes-receivable/[noteId]/extra-payments",
  },
  createSchema: { module: "@/lib/schemas/note-receivable", export: "noteReceivableExtraPaymentsReplaceSchema" },
  scenarioScoped: false,
  fields: [
    { key: "year", label: "Year", kind: "year", required: true, range: { min: 1900, max: 2200 } },
    { key: "type", label: "Type", kind: "enum", enumValues: ["per_payment", "lump_sum"], required: true, notes: "UI <select>: \"Lump sum\" | \"Per payment\"." },
    { key: "amount", label: "Amount", kind: "money", required: true, range: { min: 0 } },
  ],
};

export const NET_WORTH_OTHER_ENTITIES: readonly DetailEntity[] = [
  liabilityEntity,
  liabilityExtraPaymentEntity,
  noteReceivableEntity,
  noteReceivableExtraPaymentEntity,
];
