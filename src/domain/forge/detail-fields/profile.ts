// src/domain/forge/detail-fields/profile.ts
//
// Details → Profile (sidebar label "Profile", route `details/family`).
//
// Screen order: Household · Family Members · Trusts · Revocable Trusts ·
// Gifts (nested inside Family Members) · External Beneficiaries · Open Items.
// The page also mounts a "Divorce planning" card, but that is only a link out
// to `/clients/[id]/divorce` — no data entry happens on this tab, so it has no
// entry here.
//
// Two shapes on this tab are unusual and are called out on the entities
// themselves: `entities` and `gifts` have NO scenario column (one write is
// visible from every scenario), while `gift_series` DOES.

import type { DetailEntity } from "./types";
import { YEAR_REFS as YEAR_REF_VALUES } from "@/lib/milestones";
import { TRUST_SUB_TYPES } from "@/lib/entities/trust";

/** Contact-detail fields, client and spouse. Accepted by PUT /api/clients/[id]
 *  and mirrored onto the CRM household contacts — they are NOT columns on the
 *  `clients` row. Advisor sees them on Edit profile → Contact. */
const CONTACT_NOTE =
  "Lives on the CRM household contact, not the clients row; the PUT mirrors it across.";

export const PROFILE_ENTITIES: readonly DetailEntity[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // Household — the client and spouse themselves.
  //
  // No create route below /api/clients/[id]: a planning client is created by
  // POST /api/clients (schema `clientCreateSchema` in @/lib/schemas/resources),
  // which needs an existing CRM household. The PUT below accepts any subset of
  // these keys, so nothing here is marked `required`.
  //
  // The PUT has an explicit allowlist: identity/contact keys are mirrored to
  // CRM contacts, and only retirementAge, retirementMonth, planEndAge,
  // lifeExpectancy, spouseRetirementAge, spouseRetirementMonth,
  // spouseLifeExpectancy, filingStatus and riskTolerance reach the clients row.
  // Anything else in the body is silently ignored.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "client_household",
    label: "Household (client and spouse)",
    tab: "profile",
    surface: "Profile → Household → Edit profile",
    table: "clients",
    routes: { list: "/", update: "/", delete: "/" },
    scenarioScoped: false,
    fields: [
      {
        key: "firstName",
        label: "First Name",
        kind: "string",
        notes: CONTACT_NOTE,
      },
      {
        key: "lastName",
        label: "Last Name",
        kind: "string",
        notes: CONTACT_NOTE,
      },
      {
        key: "dateOfBirth",
        label: "Date of Birth",
        kind: "date",
        notes:
          "ISO yyyy-mm-dd. Sending it re-derives planEndAge and pushes a new planEndYear into every scenario's plan settings. " +
          CONTACT_NOTE,
      },
      {
        key: "spouseName",
        label: "Spouse First Name",
        kind: "string",
        nullable: true,
        notes:
          "Sending null or \"\" DELETES the spouse family_member row. The route answers 409 first if accounts, liabilities, business ownership, trust measuring lives, beneficiary designations or gifts still reference the spouse.",
      },
      {
        key: "spouseLastName",
        label: "Spouse Last Name",
        kind: "string",
        nullable: true,
        notes: "Blank inherits the client's last name. " + CONTACT_NOTE,
      },
      {
        key: "spouseDob",
        label: "Spouse Date of Birth",
        kind: "date",
        nullable: true,
        notes: "ISO yyyy-mm-dd. Feeds the plan-horizon recompute. " + CONTACT_NOTE,
      },
      {
        key: "retirementAge",
        label: "Retirement Age",
        kind: "number",
        range: { min: 18, max: 100 },
        notes:
          "The form offers 50–85, but the server bound (create schema) is 18–100. The PUT itself does not range-check.",
      },
      {
        key: "retirementMonth",
        label: "Retirement Month",
        kind: "number",
        defaultValue: 1,
        range: { min: 1, max: 12 },
        notes:
          "1 = January. Income/expenses tied to retirement are pro-rated for this month in the retirement year.",
      },
      {
        key: "lifeExpectancy",
        label: "Life Expectancy",
        kind: "number",
        defaultValue: 95,
        range: { min: 1, max: 130 },
        notes: "Age, not a year. Drives the plan horizon.",
      },
      {
        key: "spouseRetirementAge",
        label: "Spouse Retirement Age",
        kind: "number",
        nullable: true,
        range: { min: 18, max: 100 },
      },
      {
        key: "spouseRetirementMonth",
        label: "Spouse Retirement Month",
        kind: "number",
        nullable: true,
        range: { min: 1, max: 12 },
      },
      {
        key: "spouseLifeExpectancy",
        label: "Spouse Life Expectancy",
        kind: "number",
        nullable: true,
        range: { min: 1, max: 130 },
      },
      {
        key: "filingStatus",
        label: "Filing Status",
        kind: "enum",
        enumValues: [
          "single",
          "married_joint",
          "married_separate",
          "head_of_household",
        ],
        defaultValue: "single",
      },
      {
        key: "riskTolerance",
        label: "Risk tolerance",
        kind: "enum",
        enumValues: [
          "conservative",
          "moderately_conservative",
          "moderate",
          "moderately_aggressive",
          "aggressive",
        ],
        nullable: true,
        notes:
          "Accepted by this PUT (and 400s on an unknown value) but has NO control on the Profile tab — it is entered on Assumptions / the Import wizard.",
      },
      {
        key: "planEndAge",
        label: "Plan horizon",
        kind: "number",
        writable: false,
        notes:
          "In the PUT allowlist but recomputed server-side from the two dates of birth and life expectancies whenever any of those is in the body. Never send it.",
      },
      { key: "email", label: "Email", kind: "string", nullable: true, notes: CONTACT_NOTE },
      { key: "phone", label: "Phone", kind: "string", nullable: true, notes: CONTACT_NOTE },
      { key: "mobile", label: "Mobile", kind: "string", nullable: true, notes: CONTACT_NOTE },
      {
        key: "addressLine1",
        label: "Address line 1",
        kind: "string",
        nullable: true,
        notes: CONTACT_NOTE,
      },
      {
        key: "addressLine2",
        label: "Address line 2",
        kind: "string",
        nullable: true,
        notes: CONTACT_NOTE,
      },
      { key: "city", label: "City", kind: "string", nullable: true, notes: CONTACT_NOTE },
      {
        key: "state",
        label: "State",
        kind: "string",
        nullable: true,
        notes:
          "Free text on the contact, not a validated USPS code here. State of residence for tax purposes is set on the CRM household at create time. " +
          CONTACT_NOTE,
      },
      {
        key: "postalCode",
        label: "Postal code",
        kind: "string",
        nullable: true,
        notes: CONTACT_NOTE,
      },
      { key: "country", label: "Country", kind: "string", nullable: true, notes: CONTACT_NOTE },
      {
        key: "address",
        label: "Address line 1",
        kind: "string",
        nullable: true,
        notes:
          "Legacy single-line blob accepted for back-compat; routed to addressLine1. Prefer addressLine1.",
      },
      {
        key: "spouseEmail",
        label: "Email",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spousePhone",
        label: "Phone",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spouseMobile",
        label: "Mobile",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spouseAddressLine1",
        label: "Address line 1",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spouseAddressLine2",
        label: "Address line 2",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spouseCity",
        label: "City",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spouseState",
        label: "State",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spousePostalCode",
        label: "Postal code",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spouseCountry",
        label: "Country",
        kind: "string",
        nullable: true,
        notes: "Contact tab → Spouse section. " + CONTACT_NOTE,
      },
      {
        key: "spouseAddress",
        label: "Address line 1",
        kind: "string",
        nullable: true,
        notes:
          "Legacy single-line blob for the spouse; routed to spouseAddressLine1. Prefer spouseAddressLine1.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Family Members — children, parents, siblings and anyone else in the tree.
  //
  // No zod schema: both POST and PUT destructure the body by hand. The ONLY
  // create-time validation is `if (!firstName) 400`; everything else goes
  // straight into the insert, so an out-of-enum `relationship` reaches Postgres
  // and comes back as a 500, not a 400.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "family_member",
    label: "Family member",
    tab: "profile",
    surface: "Profile → Family Members → + Add",
    table: "familyMembers",
    routes: {
      list: "/family-members",
      create: "/family-members",
      update: "/family-members/[memberId]",
      delete: "/family-members/[memberId]",
    },
    scenarioScoped: false,
    fields: [
      {
        key: "firstName",
        label: "First Name",
        kind: "string",
        required: true,
        notes: "The only field the create path rejects the payload without.",
      },
      { key: "lastName", label: "Last Name", kind: "string", nullable: true },
      {
        key: "relationship",
        label: "Relationship",
        kind: "enum",
        enumValues: [
          "child",
          "stepchild",
          "grandchild",
          "great_grandchild",
          "parent",
          "grandparent",
          "sibling",
          "sibling_in_law",
          "child_in_law",
          "niece_nephew",
          "aunt_uncle",
          "cousin",
          "grand_aunt_uncle",
          "other",
        ],
        defaultValue: "child",
        notes:
          "NOT validated by the route — an unlisted value reaches the Postgres enum and surfaces as a 500, not a 400.",
      },
      {
        key: "dateOfBirth",
        label: "Date of Birth",
        kind: "date",
        nullable: true,
        notes: "ISO yyyy-mm-dd. An empty string is coerced to null.",
      },
      { key: "notes", label: "Notes", kind: "text", nullable: true },
      {
        key: "domesticPartner",
        label: "Domestic partner (affects NJ/MD inheritance tax)",
        kind: "boolean",
        defaultValue: false,
        notes: "Coerced with `!!` — any truthy value stores true.",
      },
      {
        key: "inheritanceClassOverride",
        label: "Inheritance tax class overrides",
        kind: "object",
        defaultValue: null,
        notes:
          'Shape: Partial<Record<"PA"|"NJ"|"KY"|"NE"|"MD", "A"|"B"|"C"|"D">>. Server default is {} (auto-classify from relationship). Not validated by the route.',
      },
      {
        key: "claimedAsDependent",
        label: "Dependent",
        kind: "enum",
        enumValues: ["auto", "yes", "no"],
        defaultValue: "auto",
        notes:
          "UPDATE ONLY — the create route ignores this key and the row defaults to 'auto'. The PUT does validate it (400 on anything else). Meaningful only for child/stepchild rows.",
      },
      {
        key: "role",
        label: "Household role",
        kind: "enum",
        enumValues: ["client", "spouse", "child", "other"],
        defaultValue: "other",
        writable: false,
        notes:
          "Neither family-members route accepts this. The client/spouse rows are created and kept in step by PUT /api/clients/[id]'s household sync.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Trusts (the `entities` table).
  //
  // ⚠️ `entities` has NO scenario column — one write is visible from every
  // scenario. Do not try to target a scenario.
  //
  // The Profile tab's dialog only ever creates trusts (entityType "trust").
  // The same routes also carry business entities (LLC / S-corp / partnership /
  // foundation), which are added from Net Worth — the business-only fields are
  // listed here because the route accepts them, with a note saying so.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "entity",
    label: "Trust or business entity",
    tab: "profile",
    surface: "Profile → Trusts → + Add Trust",
    table: "entities",
    routes: {
      list: "/entities",
      create: "/entities",
      update: "/entities/[entityId]",
      delete: "/entities/[entityId]",
    },
    createSchema: { module: "@/lib/schemas/entities", export: "entityCreateSchema" },
    scenarioScoped: false,
    fields: [
      { key: "name", label: "Name", kind: "string", required: true },
      {
        key: "entityType",
        label: "Type",
        kind: "enum",
        enumValues: ["trust", "llc", "s_corp", "c_corp", "partnership", "foundation", "other"],
        required: true,
        notes:
          "The Profile-tab dialog always sends 'trust'; the on-screen Type select maps to trustSubType. Everything but trust/foundation is treated as a business entity.",
      },
      {
        key: "trustSubType",
        label: "Type",
        kind: "enum",
        enumValues: TRUST_SUB_TYPES,
        notes:
          "Required when entityType = 'trust'; rejected otherwise. On screen: Irrevocable (generic) / ILIT / CLT / IDGT / CRT.",
      },
      {
        key: "isIrrevocable",
        label: "Irrevocable",
        kind: "boolean",
        notes:
          "Required when entityType = 'trust'; rejected otherwise. Must be true — every supported subtype is irrevocable, and the create rejects a mismatch. No control on screen; the form derives it.",
      },
      {
        key: "trustee",
        label: "Trustee",
        kind: "string",
        nullable: true,
        notes: "Free text, display only. Co-trustees comma-separated. Trust rows only.",
      },
      {
        key: "grantor",
        label: "Grantor",
        kind: "enum",
        enumValues: ["client", "spouse"],
        nullable: true,
        notes:
          "Null = 'Third party (none)'. REQUIRED (client or spouse) when trustSubType is 'clt' or 'crt' — the create 400s otherwise.",
      },
      {
        key: "trustEnds",
        label: "Trust ends",
        kind: "enum",
        enumValues: ["client_death", "spouse_death", "survivorship"],
        nullable: true,
        notes:
          "On screen the first two options read as '<first name>'s death'. Null = not specified. Trust rows only.",
      },
      {
        key: "crummeyPowers",
        label: "Crummey powers",
        kind: "boolean",
        defaultValue: false,
        notes: "Trust default applied to new gifts; per-gift overrides live on the gift row.",
      },
      {
        key: "accessibleToClient",
        label: "Sprinkle provisions",
        kind: "boolean",
        defaultValue: false,
        notes:
          "Surfaces the trust's assets in the Accessible Trust Assets column once household liquid assets run out. No-op when includeInPortfolio is true.",
      },
      {
        key: "isGrantor",
        label: "Grantor trust",
        kind: "boolean",
        defaultValue: false,
        notes: "True = the household pays tax on the trust's income instead of the trust.",
      },
      {
        key: "grantorStatusEndYear",
        label: "Grantor status ends after year",
        kind: "year",
        nullable: true,
        notes:
          "Inclusive last year of grantor treatment. Null = permanent. Only meaningful with isGrantor true.",
      },
      {
        key: "includeInPortfolio",
        label: "Include in portfolio",
        kind: "boolean",
        defaultValue: false,
        notes:
          "Rolls the entity's accounts into the household portfolio view. No control in the Profile-tab trust dialog.",
      },
      {
        key: "distributionMode",
        label: "Distribution Policy",
        kind: "enum",
        enumValues: ["fixed", "pct_liquid", "pct_income"],
        nullable: true,
        notes:
          "Trust rows only, and only on irrevocable trusts. Null = None. 'fixed' requires distributionAmount and forbids distributionPercent; the two pct_ modes are the reverse.",
      },
      {
        key: "distributionAmount",
        label: "Annual amount",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes: "Required when distributionMode = 'fixed', must be null otherwise.",
      },
      {
        key: "distributionPercent",
        label: "Annual percent",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes:
          "DECIMAL FRACTION (0.04 = 4%), even though the field reads as a percent on screen. Required for 'pct_liquid'/'pct_income', must be null otherwise.",
      },
      {
        key: "taxTreatment",
        label: "Tax treatment",
        kind: "enum",
        enumValues: ["qbi", "ordinary", "non_taxable"],
        defaultValue: "ordinary",
        notes: "Edited on the entity dialog's Flows tab, not on the Profile-tab Details tab.",
      },
      {
        key: "flowMode",
        label: "Flow mode",
        kind: "enum",
        enumValues: ["annual", "schedule"],
        defaultValue: "annual",
        notes:
          "'schedule' makes the engine read entity_flow_overrides exclusively (empty years resolve to 0). Set from the Flows tab.",
      },
      {
        key: "value",
        label: "Value",
        kind: "money",
        defaultValue: 0,
        notes:
          "Flat equity value for BUSINESS entities. Trusts/foundations hold value through child accounts and leave this at 0. Accepts a number or a numeric string.",
      },
      {
        key: "basis",
        label: "Basis",
        kind: "money",
        defaultValue: 0,
        notes: "Cost basis for business entities; used at death for step-up. Zero for trusts.",
      },
      {
        key: "owners",
        label: "Ownership",
        kind: "array",
        notes:
          "Business entities only — trusts and foundations skip it. Shape: [{ familyMemberId: uuid, percent: 0..1 }]. Every familyMemberId must belong to this client and the percents must sum to 1.0 (±0.0001) or the route 400s.",
      },
      {
        key: "owner",
        label: "Owner",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        nullable: true,
        notes:
          "DEPRECATED, superseded by `owners`. Forced to null for trust/foundation rows, and derived from `owners` when those are supplied. Prefer `owners`.",
      },
      {
        key: "beneficiaries",
        label: "Beneficiaries",
        kind: "array",
        nullable: true,
        notes:
          "DEPRECATED legacy JSON ({ name, pct }[]); the trust form writes []. Real designations go through the trust_beneficiary_designation entity below.",
      },
      {
        key: "distributionPolicyPercent",
        label: "Distribution policy",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes:
          "DECIMAL FRACTION. Business entities only — the route nulls it for trust/foundation. Share of net income distributed to entity owners each year.",
      },
      {
        key: "valueGrowthRate",
        label: "Value growth rate",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes:
          "DECIMAL FRACTION. Business entities only — nulled for trust/foundation. Null = 0% growth on the standalone equity value.",
      },
      { key: "notes", label: "Notes", kind: "text", nullable: true },
      {
        key: "splitInterest",
        label: "CLT Details / CRT Details",
        kind: "object",
        notes:
          "Nested payload, REQUIRED when trustSubType is 'clt' or 'crt' and rejected otherwise. Its keys are catalogued as the trust_split_interest entity below.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // CLT / CRT split-interest detail.
  //
  // No route of its own: every field below is a key inside the `splitInterest`
  // object on the trust create/update payload, which is why the routes here are
  // the entity routes. Kept separate because flattening 15 keys onto the trust
  // would hide the fact that they only exist for two subtypes.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "trust_split_interest",
    nestedIn: { entity: "entity", key: "splitInterest" },
    label: "CLT / CRT split-interest detail",
    tab: "profile",
    surface: "Profile → Trusts → Add Trust → CLT Details / CRT Details",
    table: "trustSplitInterestDetails",
    routes: { create: "/entities", update: "/entities/[entityId]" },
    createSchema: {
      module: "@/lib/schemas/trust-split-interest",
      export: "trustSplitInterestSchema",
    },
    scenarioScoped: false,
    fields: [
      {
        key: "origin",
        label: "Trust origin",
        kind: "enum",
        enumValues: ["new", "existing"],
        defaultValue: "new",
        notes:
          "'new' = funded in this plan: the API computes the two interests and (CLT only) auto-emits the remainder-interest gift. 'existing' = funded historically: you must supply originalIncomeInterest and originalRemainderInterest, and nothing is auto-emitted.",
      },
      {
        key: "inceptionYear",
        label: "Inception year",
        kind: "year",
        required: true,
        range: { min: 1900, max: 2200 },
        notes: "Reads as 'Original funding year' when origin = 'existing'.",
      },
      {
        key: "inceptionValue",
        label: "Funding-year FMV",
        kind: "money",
        required: true,
        range: { min: 0 },
        notes: "Reads as 'FMV at original funding' when origin = 'existing'.",
      },
      {
        key: "payoutType",
        label: "Payment type",
        kind: "enum",
        enumValues: ["unitrust", "annuity"],
        required: true,
        notes: "On screen: CLUT (unitrust, % of trust value) vs CLAT (annuity, fixed $).",
      },
      {
        key: "payoutPercent",
        label: "Payout percentage",
        kind: "rate",
        range: { min: 0, max: 1 },
        notes:
          "DECIMAL FRACTION (0.05 = 5%) even though the field shows whole percent. Required when payoutType = 'unitrust', must be omitted for 'annuity'.",
      },
      {
        key: "payoutAmount",
        label: "Annual payment",
        kind: "money",
        range: { min: 0 },
        notes:
          "Required when payoutType = 'annuity', must be omitted for 'unitrust'.",
      },
      {
        key: "irc7520Rate",
        label: "IRC §7520 rate",
        kind: "rate",
        required: true,
        range: { min: 0, max: 1 },
        notes: "DECIMAL FRACTION (0.052 = 5.2%). Locked at inception.",
      },
      {
        key: "termType",
        label: "Term type",
        kind: "enum",
        enumValues: ["years", "single_life", "joint_life", "shorter_of_years_or_life"],
        required: true,
        notes:
          "On screen: Years (term certain) / Single life / Joint life (last survivor) / Shorter of years or life.",
      },
      {
        key: "termYears",
        label: "Term years",
        kind: "number",
        range: { min: 1 },
        notes:
          "Required for 'years' and 'shorter_of_years_or_life', must be omitted otherwise. A CRT is capped at 20 years (§664).",
      },
      {
        key: "measuringLife1Id",
        label: "Measuring life 1",
        kind: "uuid",
        notes:
          "A family_members id belonging to this client, and it MUST have a date_of_birth or the create 400s. Required for single_life, joint_life and shorter_of_years_or_life.",
      },
      {
        key: "measuringLife2Id",
        label: "Measuring life 2",
        kind: "uuid",
        notes:
          "Required for 'joint_life' and rejected for every other termType. Same family-member and date-of-birth rules as measuringLife1Id.",
      },
      {
        key: "charityId",
        label: "Charitable beneficiary",
        kind: "uuid",
        required: true,
        notes:
          "An external_beneficiaries id belonging to this client. The CRT form labels it 'Remainder charity'. Create the charity first (see external_beneficiary).",
      },
      {
        key: "originalIncomeInterest",
        label: "Income interest (deduction taken)",
        kind: "money",
        range: { min: 0 },
        notes:
          "REQUIRED when origin = 'existing', ignored otherwise (the API computes it for 'new'). CRT form labels it 'Income interest (retained)'.",
      },
      {
        key: "originalRemainderInterest",
        label: "Remainder interest (gift filed)",
        kind: "money",
        range: { min: 0 },
        notes:
          "REQUIRED when origin = 'existing', ignored otherwise. CRT form labels it 'Charitable deduction filed'.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Trust beneficiary designations — the Income / Remainder rows inside the
  // trust dialog. Its own route, and a FULL-SET REPLACE: the PUT deletes every
  // existing designation for the trust and re-inserts the array you send.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "trust_beneficiary_designation",
    payloadShape: "array",
    label: "Trust beneficiary",
    tab: "profile",
    surface: "Profile → Trusts → Add Trust → Income / Remainder beneficiaries",
    table: "beneficiaryDesignations",
    routes: {
      list: "/entities/[entityId]/beneficiaries",
      update: "/entities/[entityId]/beneficiaries",
    },
    createSchema: { module: "@/lib/schemas/beneficiaries", export: "beneficiarySetSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "tier",
        label: "Income beneficiaries / Remainder beneficiaries",
        kind: "enum",
        enumValues: ["primary", "contingent", "income", "remainder"],
        required: true,
        notes:
          "Trusts use 'income' and 'remainder'; 'primary'/'contingent' are the account-designation tiers. Percentages are validated per tier.",
      },
      {
        key: "percentage",
        label: "Percent",
        kind: "percent",
        required: true,
        range: { min: 0, max: 100 },
        notes:
          "WHOLE NUMBER (50 = 50%), unlike most rate fields in this app. Must be > 0 and ≤ 100; the set must satisfy the shared split validator.",
      },
      {
        key: "familyMemberId",
        label: "Beneficiary",
        kind: "uuid",
        nullable: true,
        notes:
          "Exactly one of familyMemberId / externalBeneficiaryId / entityIdRef / householdRole per row. Must belong to this client.",
      },
      {
        key: "externalBeneficiaryId",
        label: "Beneficiary",
        kind: "uuid",
        nullable: true,
        notes: "See familyMemberId — exactly one of the four. Must belong to this client.",
      },
      {
        key: "entityIdRef",
        label: "Beneficiary",
        kind: "uuid",
        nullable: true,
        notes:
          "Names ANOTHER entity (e.g. trust → trust) as beneficiary. Must belong to this client. See familyMemberId — exactly one of the four.",
      },
      {
        key: "householdRole",
        label: "Beneficiary",
        kind: "enum",
        enumValues: ["client", "spouse"],
        nullable: true,
        notes: "Names the household principal. See familyMemberId — exactly one of the four.",
      },
      {
        key: "sortOrder",
        label: "Beneficiary order",
        kind: "number",
        defaultValue: 0,
        range: { min: 0 },
        notes: "Omitted rows fall back to their index in the array you send.",
      },
      {
        key: "distributionForm",
        label: "Distribution form",
        kind: "enum",
        enumValues: ["in_trust", "outright"],
        defaultValue: "outright",
        notes:
          "Remainder tier only — the schema drops it for every other tier. Defaults to 'outright'.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Revocable trusts — a probate tag on accounts, not an `entities` row.
  // Both POST and PATCH take the SAME upsert body; the PATCH diffs membership
  // (tags the ids you send, clears the ones you leave out).
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "revocable_trust",
    label: "Revocable trust",
    tab: "profile",
    surface: "Profile → Revocable Trusts → + Add Revocable Trust",
    table: "revocableTrusts",
    routes: {
      list: "/revocable-trusts",
      create: "/revocable-trusts",
      update: "/revocable-trusts/[trustId]",
      delete: "/revocable-trusts/[trustId]",
    },
    createSchema: {
      module: "@/lib/schemas/revocable-trusts",
      export: "revocableTrustUpsertSchema",
    },
    scenarioScoped: false,
    fields: [
      {
        key: "name",
        label: "Trust name",
        kind: "string",
        required: true,
        range: { min: 1, max: 120 },
      },
      {
        key: "accountIds",
        label: "Accounts in this trust",
        kind: "array",
        defaultValue: null,
        notes:
          "Array of account uuids; server default is []. FULL MEMBERSHIP LIST, not a delta — on update, accounts already tagged into this trust but absent from the array are untagged. Only cash, taxable and real-estate accounts are offered on screen.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Gifts (one-time).
  //
  // ⚠️ `gifts` has NO scenario column — one write is visible from every
  // scenario. Its sibling `gift_series` DOES have one; do not treat them alike.
  //
  // Shape rules: a CASH gift needs `amount` and no `percent`; an ASSET or
  // LIABILITY transfer needs `percent` and no `amount`. The PATCH schema omits
  // accountId / liabilityId / parentGiftId on purpose, so changing a gift's
  // shape means create-then-delete, not a patch.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "gift",
    label: "Gift",
    tab: "profile",
    surface: "Profile → Family Members → Gifts → + Add gift (Frequency: One-time)",
    table: "gifts",
    routes: {
      list: "/gifts",
      create: "/gifts",
      update: "/gifts/[giftId]",
      delete: "/gifts/[giftId]",
    },
    createSchema: { module: "@/lib/schemas/gifts", export: "giftCreateSchema" },
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
        key: "yearRef",
        label: "Year anchor",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: "Milestone anchor for `year`. No control in the gift dialog on this tab.",
      },
      {
        key: "amount",
        label: "Amount",
        kind: "money",
        nullable: true,
        range: { min: 0 },
        notes:
          "Strictly greater than 0. REQUIRED for a cash gift; the route forces it to null whenever accountId or liabilityId is set. Stays the FULL undiscounted value — the valuation discount is never folded in.",
      },
      {
        key: "grantor",
        label: "Grantor",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        required: true,
        notes: "'joint' reads as 'Both (split gift)' — half from each spouse.",
      },
      {
        key: "recipientEntityId",
        label: "Recipient",
        kind: "uuid",
        nullable: true,
        notes:
          "Exactly one of recipientEntityId / recipientFamilyMemberId / recipientExternalBeneficiaryId. Must be an IRREVOCABLE TRUST belonging to this client — LLCs, foundations and revocable trusts are all 400s.",
      },
      {
        key: "recipientFamilyMemberId",
        label: "Recipient",
        kind: "uuid",
        nullable: true,
        notes: "Must belong to this client. See recipientEntityId — exactly one of the three.",
      },
      {
        key: "recipientExternalBeneficiaryId",
        label: "Recipient",
        kind: "uuid",
        nullable: true,
        notes: "Must belong to this client. See recipientEntityId — exactly one of the three.",
      },
      {
        key: "accountId",
        label: "Asset",
        kind: "uuid",
        nullable: true,
        notes:
          "CREATE ONLY — the update schema omits it, so re-pointing an asset gift means create-then-delete. Setting it makes this an asset transfer: `percent` becomes required and `amount` is forced null. Must belong to this client. If a liability is linked to the gifted property, the POST auto-creates a bundled child gift row for it.",
      },
      {
        key: "liabilityId",
        label: "Liability",
        kind: "uuid",
        nullable: true,
        notes:
          "CREATE ONLY, same as accountId, and mutually exclusive with it. No control in the gift dialog — the route sets it on the auto-bundled child row.",
      },
      {
        key: "percent",
        label: "Gift size",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 1 },
        notes:
          "DECIMAL FRACTION (0.25 = 25%), strictly greater than 0 and at most 1, even though the field shows whole percent. REQUIRED for an asset/liability transfer and rejected on a cash gift. Entering a dollar amount on screen converts to the share worth that much in the gift year.",
      },
      {
        key: "valuationDiscount",
        label: "Valuation discount (%)",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 0.99995 },
        notes:
          "DECIMAL FRACTION (0.3 = 30%) — the field shows whole percent and the UI caps it at 99. Upper bound is EXCLUSIVE 0.99995: anything at or above it rounds to 1.0000 in numeric(6,4) and trips the CHECK as a 500. Null = no discount. Transfer-tax only — never folded into amount or percent, and never reaches the recipient's balance sheet.",
      },
      {
        key: "useCrummeyPowers",
        label: "Use Crummey powers (annual-exclusion gift)",
        kind: "boolean",
        defaultValue: false,
        notes:
          "Offered only for trust recipients on cash gifts; the dialog sends false for asset transfers.",
      },
      {
        key: "notes",
        label: "Notes",
        kind: "text",
        nullable: true,
        notes: "Accepted by both routes; the gift dialog on this tab has no control for it.",
      },
      {
        key: "eventKind",
        label: "Gift kind",
        kind: "enum",
        enumValues: ["outright", "clt_remainder_interest"],
        defaultValue: "outright",
        writable: false,
        notes:
          "The create route 400s on anything but 'outright'. 'clt_remainder_interest' rows are auto-emitted when a new CLT is created.",
      },
      {
        key: "parentGiftId",
        label: "Bundled with",
        kind: "uuid",
        nullable: true,
        writable: false,
        notes:
          "In the create schema but the route hard-codes null — only the auto-bundled liability child row carries it. The update schema omits it entirely.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Recurring gifts (`gift_series`). Unlike `gifts`, this table DOES carry a
  // scenario_id — the route writes into ?scenario=<id> when one is selected and
  // the base case otherwise, and the list route filters by the same partition.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "gift_series",
    label: "Recurring gift",
    tab: "profile",
    surface: "Profile → Family Members → Gifts → + Add gift (Frequency: Recurring)",
    table: "giftSeries",
    routes: {
      list: "/gifts/series",
      create: "/gifts/series",
      update: "/gifts/series/[seriesId]",
      delete: "/gifts/series/[seriesId]",
    },
    createSchema: { module: "@/lib/schemas/gift-series", export: "giftSeriesSchema" },
    scenarioScoped: true,
    fields: [
      {
        key: "grantor",
        label: "Grantor",
        kind: "enum",
        enumValues: ["client", "spouse", "joint"],
        required: true,
      },
      {
        key: "recipientEntityId",
        label: "Recipient",
        kind: "uuid",
        nullable: true,
        notes:
          "Exactly one of the three recipient keys. Must be an IRREVOCABLE TRUST belonging to this client — recurring gifts target irrevocable trusts only.",
      },
      {
        key: "recipientFamilyMemberId",
        label: "Recipient",
        kind: "uuid",
        nullable: true,
        notes: "Must belong to this client. Exactly one of the three recipient keys.",
      },
      {
        key: "recipientExternalBeneficiaryId",
        label: "Recipient",
        kind: "uuid",
        nullable: true,
        notes: "Must belong to this client. Exactly one of the three recipient keys.",
      },
      {
        key: "startYear",
        label: "Start year",
        kind: "year",
        required: true,
        range: { min: 1900, max: 2200 },
      },
      {
        key: "endYear",
        label: "End year",
        kind: "year",
        required: true,
        range: { min: 1900, max: 2200 },
        notes: "Must be ≥ startYear (schema refinement plus a table CHECK).",
      },
      {
        key: "startYearRef",
        label: "Start year anchor",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: "No control in the gift dialog on this tab.",
      },
      {
        key: "endYearRef",
        label: "End year anchor",
        kind: "enum",
        enumValues: YEAR_REF_VALUES,
        nullable: true,
        notes: "No control in the gift dialog on this tab.",
      },
      {
        key: "annualAmount",
        label: "Amount",
        kind: "money",
        required: true,
        range: { min: 0 },
        notes:
          "Strictly greater than 0, and required even when amountMode is 'annual_exclusion' (the engine substitutes the exclusion at projection time).",
      },
      {
        key: "amountMode",
        label: "Amount",
        kind: "enum",
        enumValues: ["fixed", "annual_exclusion"],
        defaultValue: "fixed",
        notes: "On screen: 'Fixed $' vs 'Max annual exclusion'.",
      },
      {
        key: "inflationAdjust",
        label: "Inflation-adjust each year",
        kind: "boolean",
        defaultValue: false,
        notes: "Offered only when amountMode is 'fixed'.",
      },
      {
        key: "useCrummeyPowers",
        label: "Use Crummey powers (annual-exclusion gift)",
        kind: "boolean",
        defaultValue: false,
      },
      {
        key: "valuationDiscount",
        label: "Valuation discount (%)",
        kind: "rate",
        nullable: true,
        range: { min: 0, max: 0.99995 },
        notes:
          "DECIMAL FRACTION (0.3 = 30%); the field shows whole percent. Same exclusive 0.99995 upper bound and numeric(6,4) CHECK as the one-time gift. Applied to EVERY fanned-out yearly occurrence.",
      },
      {
        key: "notes",
        label: "Notes",
        kind: "text",
        nullable: true,
        notes: "Accepted by both routes; no control in the gift dialog.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Open items — the advisor's follow-up list at the foot of the Profile page.
  // Both schemas are `.strict()`: an unknown key is a 400, not a silent drop.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "open_item",
    label: "Open item",
    tab: "profile",
    surface: "Profile → Open Items",
    table: "clientOpenItems",
    routes: {
      list: "/open-items",
      create: "/open-items",
      update: "/open-items/[itemId]",
      delete: "/open-items/[itemId]",
    },
    createSchema: { module: "@/lib/schemas/open-items", export: "openItemCreateSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "title",
        label: "Title",
        kind: "string",
        required: true,
        range: { min: 1, max: 500 },
      },
      {
        key: "priority",
        label: "Priority",
        kind: "enum",
        enumValues: ["low", "medium", "high"],
        defaultValue: "medium",
      },
      {
        key: "dueDate",
        label: "Due date",
        kind: "date",
        nullable: true,
        notes: "ISO 8601 date (yyyy-mm-dd, optionally with a time suffix).",
      },
      {
        key: "completedAt",
        appliesTo: "update",
        label: "Completed",
        kind: "date",
        nullable: true,
        notes:
          "UPDATE ONLY — the create schema is strict and 400s on this key. Full ISO datetime to complete, null to reopen. The list route hides items completed more than 90 days ago.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────────
  // External beneficiaries — charities and non-family individuals. Listed last
  // to match the screen, but they are a PREREQUISITE for CLT/CRT trusts
  // (`charityId`) and for gifts to a charity.
  // ───────────────────────────────────────────────────────────────────────────
  {
    id: "external_beneficiary",
    label: "External beneficiary",
    tab: "profile",
    surface: "Profile → External Beneficiaries → + Add",
    table: "externalBeneficiaries",
    routes: {
      list: "/external-beneficiaries",
      create: "/external-beneficiaries",
      update: "/external-beneficiaries/[beneficiaryId]",
      delete: "/external-beneficiaries/[beneficiaryId]",
    },
    createSchema: {
      module: "@/lib/schemas/beneficiaries",
      export: "externalBeneficiaryCreateSchema",
    },
    scenarioScoped: false,
    fields: [
      { key: "name", label: "Name", kind: "string", required: true },
      {
        key: "kind",
        label: "Kind",
        kind: "enum",
        enumValues: ["charity", "individual"],
        defaultValue: "charity",
      },
      {
        key: "charityType",
        label: "Charity type",
        kind: "enum",
        enumValues: ["public", "private"],
        defaultValue: "public",
        notes:
          "Drives the §170 deduction limit. No control on the Profile tab — it is only set from the Solver's estate editor, so rows added here are always 'public'.",
      },
      { key: "notes", label: "Notes", kind: "text", nullable: true },
    ],
  },
];
