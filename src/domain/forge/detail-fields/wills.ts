// src/domain/forge/detail-fields/wills.ts
//
// Wills tab (`/clients/[id]/details/wills` → wills-content.tsx → WillsPanel in
// src/components/wills-panel.tsx).
//
// THE ONE THING TO KNOW BEFORE WRITING ANY OF THIS: only `wills` has its own
// route (`POST /wills`, `GET|PATCH|DELETE /wills/[willId]`). Bequests,
// bequest recipients, and residuary recipients have NO independent route —
// they are nested arrays (`bequests`, `residuaryRecipients`) on the will's
// own create/update body, validated by `willCreateSchema` / `willUpdateSchema`
// in src/lib/schemas/wills.ts. There is no PATCH-one-bequest endpoint.
//
// PATCH /wills/[willId] is a FULL REPLACE of both arrays: the route deletes
// every existing `will_bequests` row for that will (cascading to
// `will_bequest_recipients`) and every `will_residuary_recipients` row, then
// re-inserts whatever arrays were sent (src/app/api/clients/[id]/wills/
// [willId]/route.ts, PATCH handler). Two consequences that matter to Forge:
//   1. To add/edit/remove ONE bequest, resend the ENTIRE `bequests` array
//      (existing rows + the one change) and the entire `residuaryRecipients`
//      array. Sending just the new/changed item deletes everything else.
//   2. Every bequest/recipient/residuary row gets a BRAND NEW uuid on every
//      PATCH, even for rows whose content didn't change (delete-then-insert,
//      and the create/update zod schemas don't even accept a caller-supplied
//      `id` on these nested objects — it would be silently stripped). Never
//      assume a bequest id from a prior read is still valid after a later
//      write to the same will.
//
// The `wills` table itself has `executor` (text) and `executionDate` (date)
// columns (src/db/schema.ts) that are COULD NOT BE CONFIRMED as part of this
// Details tab: `willCreateSchema`/`willUpdateSchema` don't include them, the
// wills API routes never read or write them, and wills-content.tsx never
// fetches or passes them to WillsPanel — grepping the whole src tree, the
// only writer of `wills.executor`/`wills.executionDate` is the DOCUMENT
// IMPORT commit path (src/lib/imports/commit/wills.ts), a different surface
// from Details. They are deliberately excluded below rather than guessed at.
//
// Scenario behavior: none of the four tables below have a `scenarioId`
// column, so `scenarioScoped: false` throughout by the table-column
// definition. But the human UI is scenario-AWARE at the write-path level in a
// way that doesn't show up in the schema: when a non-base scenario is
// selected, WillsPanel routes the save through `useScenarioWriter`, which
// POSTs a JSON diff to the generic `/api/clients/[id]/scenarios/[sid]/changes`
// endpoint instead of calling `/wills` at all (src/hooks/use-scenario-writer.ts).
// That endpoint is shared across every entity type, not wills-specific, so it
// isn't listed as a route below. The upshot for Forge: writing straight to
// `POST /wills` / `PATCH /wills/[willId]` always lands in the base case,
// regardless of what scenario the advisor happens to have open in their tab.
import type { DetailEntity } from "./types";

export const WILLS_ENTITIES: readonly DetailEntity[] = [
  {
    id: "will",
    label: "Will",
    tab: "wills",
    surface:
      "Wills → \"{grantorName}'s Will\" (one section per household principal; the spouse's section only renders when a spouse exists on file). There is no \"Add Will\" button — the will row is created implicitly the first time a bequest or residuary recipient is saved for that grantor.",
    table: "wills",
    routes: {
      list: "/wills",
      create: "/wills",
      update: "/wills/[willId]",
      delete: "/wills/[willId]",
    },
    createSchema: { module: "@/lib/schemas/wills", export: "willCreateSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "grantor",
        label: "\"{grantorName}'s Will\" section heading",
        kind: "enum",
        enumValues: ["client", "spouse"],
        required: true,
        notes:
          "Not a labeled input — it's which grantor's section the advisor is working in. One will per (clientId, grantor); POST /wills 409s with \"A will already exists for grantor='<g>'\" if that grantor already has one. 'spouse' is only offered/rendered when the household has a spouse on file (primary.spouseName non-null, sourced from the CRM household contact with role='spouse').",
      },
      {
        key: "bequests",
        label: "Bequests",
        kind: "array",
        required: false,
        notes:
          "Defaults to [] on create (zod .default([])) — omitting the key is fine, sending [] and omitting it behave the same. Each item has the shape of the `will_bequests` entity below. FULL REPLACE on every write: see the file-level comment — resending this array without an existing bequest deletes that bequest.",
      },
      {
        key: "residuaryRecipients",
        label: "Remainder estate",
        kind: "array",
        required: false,
        notes:
          "Optional (zod .optional(), no default — distinct from bequests' .default([]), though both read back as \"no rows\" either way). Each item has the shape of the `will_residuary_recipients` entity below. An empty/omitted array is a valid, meaningful state: the UI shows \"No remainder clause specified. Residual assets are distributed by the default order — surviving spouse, then children, then other heirs.\" Same FULL REPLACE semantics as `bequests` on PATCH.",
      },
    ],
  },
  {
    id: "will_bequest",
    nestedIn: { entity: "will", key: "bequests" },
    label: "Bequest",
    tab: "wills",
    surface:
      "Wills → \"{grantorName}'s Will\" → + Add bequest → \"New bequest\" / \"Edit bequest\" dialog (src/components/bequest-dialog/index.tsx)",
    table: "willBequests",
    routes: {
      create: "/wills",
      update: "/wills/[willId]",
    },
    createSchema: { module: "@/lib/schemas/wills", export: "willBequestSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "kind",
        label: "Asset or debt",
        kind: "enum",
        enumValues: ["asset", "liability"],
        required: true,
        notes:
          "Discriminant of a zod discriminatedUnion (willBequestAssetSchema | willBequestLiabilitySchema) — which of assetMode/accountId/entityId/liabilityId/percentage below are accepted, required, or forbidden depends on this value; see each field's notes. Picking a target in the single \"Asset or debt\" dropdown sets this plus assetMode/accountId/entityId/liabilityId together — the advisor never sets `kind` on its own. GOTCHA: the create/update schemas do not accept a caller-supplied `id` on a bequest object at all — the server always assigns a fresh uuid via INSERT ... RETURNING, and PATCH deletes+reinserts every bequest on the will every time (see file-level comment).",
      },
      {
        key: "name",
        label: "(no on-screen text label — see notes)",
        kind: "string",
        required: true,
        notes:
          "Required by the schema (trim, 1-200 chars) but NOT a free-text field the advisor types: bequest-dialog/index.tsx's deriveBequestName() computes it from the \"Asset or debt\" selection before saving — the selected account's/entity's/liability's name, or \"Remaining Estate Value\" when assetMode='all_assets'. Forge writing extracted data should supply an equivalent derived name (e.g. the linked account/entity/liability's own name) rather than an arbitrary label.",
      },
      {
        key: "assetMode",
        label: "Asset or debt",
        kind: "enum",
        enumValues: ["specific", "all_assets"],
        required: false,
        nullable: true,
        notes:
          "Required (one of the two values) when kind='asset'; must be null/omitted when kind='liability' (willBequestLiabilitySchema declares it z.null().optional()). 'all_assets' = the \"Remaining Estate Value\" dropdown option (bequeaths whatever's left after other specific bequests); 'specific' = a named account or business entity, set together with accountId or entityId below.",
      },
      {
        key: "accountId",
        label: "Asset or debt",
        kind: "uuid",
        required: false,
        nullable: true,
        notes:
          "Only accepted when kind='asset'. Must be set (and mutually exclusive with entityId) when assetMode='specific'; must be null when assetMode='all_assets'. Cross-referenced server-side against this client's `accounts` — a 400 (\"One or more accountIds do not belong to this client\") if it doesn't resolve. The picker (src/components/bequest-dialog/index.tsx) additionally hides accounts already 100%-owned by an entity, and accounts with category 'retirement' or 'life_insurance' (those transfer by beneficiary designation, not the will) — Forge should avoid targeting those categories even though the server doesn't itself reject them by category.",
      },
      {
        key: "entityId",
        label: "Asset or debt",
        kind: "uuid",
        required: false,
        nullable: true,
        defaultValue: null,
        notes:
          "Only accepted when kind='asset' (schema default null). Must be set (and mutually exclusive with accountId) when assetMode='specific' and the target is a business interest; must be null when assetMode='all_assets'. Cross-referenced against this client's `entities`. The UI only offers business-type entities here (llc/s_corp/c_corp/partnership/other) — an entity used purely as a beneficiary (e.g. a charity or third-party trust) belongs in a recipient's `recipientId`, not here.",
      },
      {
        key: "liabilityId",
        label: "Asset or debt",
        kind: "uuid",
        required: false,
        nullable: true,
        notes:
          "Required when kind='liability' (uuid, non-nullable in that branch); must be null/omitted when kind='asset'. Cross-referenced against this client's `liabilities`, and rejected (400 liability_not_found / liability_linked_not_bequestable / liability_entity_owned_not_bequestable) if the liability doesn't belong to the client, is linked to a property, or is entity-owned. Also unique per will: a second bequest naming the same liabilityId 23505s → mapped to 400 { error: \"duplicate_liability_bequest\" } (unique index will_bequests_liability_idx).",
      },
      {
        key: "percentage",
        label: "Percentage",
        kind: "percent",
        required: false,
        range: { min: 0, max: 100 },
        notes:
          "Whole-number percent (e.g. 25 means 25%), NOT a decimal fraction. Only accepted/required when kind='asset' (gt 0, lte 100). GOTCHA: for kind='liability' the field isn't even in the zod shape — any value sent is silently dropped, and the route ALWAYS persists percentage='100' on the DB row for a liability bequest regardless of input (src/app/api/clients/[id]/wills/[willId]/route.ts). A liability bequest's real \"how much\" lives in its recipients' percentages instead (0% < sum ≤ 100%, with any remainder implicitly falling to estate creditor-payoff).",
      },
      {
        key: "condition",
        label: "Condition",
        kind: "enum",
        enumValues: ["always", "if_spouse_survives", "if_spouse_predeceased"],
        required: true,
        notes:
          "On-screen button labels: always → \"Always\", if_spouse_survives → \"If spouse survives\", if_spouse_predeceased → \"If spouse predeceases\". Always required by the schema for both kinds, but for kind='liability' the schema pins it to the literal 'always' — sending anything else on a liability bequest is a validation error. The Condition button row in the dialog is only rendered at all when the household has a spouse on file; otherwise the value stays 'always' by default.",
      },
      {
        key: "sortOrder",
        label: "(not directly labeled — see notes)",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes:
          "Not a field the advisor types. The UI recomputes a contiguous 0-based sortOrder from the bequest's position in the list every time it saves (drag is via the ↑/↓ buttons, which swap two rows' sortOrder and resave the whole array). Forge writing a new list should just assign 0..N-1 in the intended display order.",
      },
      {
        key: "recipients",
        label: "Recipients",
        kind: "array",
        required: true,
        notes:
          "Non-empty (min 1) for both kinds. Each item has the shape of the `will_bequest_recipients` entity below. Sum-of-percentage rule differs by this bequest's kind: kind='asset' → recipient percentages must sum to exactly 100 (±0.01). kind='liability' → sum must be >0 and ≤100.01, with room left over (\"falls to estate creditor-payoff\" per the UI). Liability bequests also restrict recipientKind to 'family_member' or 'entity' only — 'spouse' and 'external_beneficiary' are rejected by willBequestLiabilitySchema's superRefine for a debt bequest even though they're valid for asset bequests and residuary recipients.",
      },
    ],
  },
  {
    id: "will_bequest_recipient",
    nestedIn: { entity: "will_bequest", key: "recipients" },
    label: "Bequest recipient",
    tab: "wills",
    surface:
      "Wills → \"{grantorName}'s Will\" → + Add bequest / Edit bequest dialog → Recipients list (src/components/forms/bequest-recipient-list.tsx)",
    table: "willBequestRecipients",
    routes: {
      create: "/wills",
      update: "/wills/[willId]",
    },
    createSchema: { module: "@/lib/schemas/wills", export: "willBequestRecipientSchema" },
    scenarioScoped: false,
    fields: [
      {
        key: "recipientKind",
        label: "Recipients",
        kind: "enum",
        enumValues: ["family_member", "external_beneficiary", "entity", "spouse"],
        required: true,
        notes:
          "The recipient reference is a DISCRIMINATED UNION keyed on this field, chosen implicitly by which dropdown group the advisor picks from (optgroups \"Household\" / \"Family\" / \"External\" / \"Entity\" in bequest-recipient-list.tsx) — there's no separate visible \"kind\" control. Meaning of each value: 'family_member' → recipientId is a family_members.id belonging to this client, EXCLUDING rows with role 'client' or 'spouse' (those two principals are only ever referenced via the 'spouse' kind below, never as a plain family_member). 'external_beneficiary' → recipientId is an external_beneficiaries.id for this client (e.g. a friend, charity, or other non-family payee). 'entity' → recipientId is an entities.id for this client — a business or trust used as a beneficiary. 'spouse' → recipientId MUST be null; refers to the GRANTOR'S spouse, i.e. the other household principal (client's will → the spouse; spouse's will → the client) — only offered when primary.spouseName is non-null. Every non-null recipientId is cross-referenced server-side against this client's own rows (400 if it doesn't belong to the client) — see verifyCrossRefs in src/app/api/clients/[id]/wills/_helpers.ts.",
      },
      {
        key: "recipientId",
        label: "Recipients",
        kind: "uuid",
        required: true,
        nullable: true,
        notes:
          "Required and non-null for every recipientKind EXCEPT 'spouse', where it must be null (zod superRefine, not a plain .nullable() — sending a non-null id with recipientKind='spouse', or null with any other kind, is a 400). See recipientKind's notes for the full reference shape.",
      },
      {
        key: "percentage",
        label: "(no static label — numeric input beside each recipient, with a trailing \"%\")",
        kind: "percent",
        required: true,
        range: { min: 0, max: 100 },
        notes:
          "Whole-number percent (25 means 25%). Per-recipient share of the PARENT BEQUEST, not of the whole estate. The set of a bequest's recipients must sum per the parent will_bequests row's kind — see that entity's `recipients` field notes (exact 100% for an asset bequest; 0–100% for a liability bequest).",
      },
      {
        key: "sortOrder",
        label: "(not directly labeled — see notes)",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes:
          "Positional only — recomputed from the recipient row's order in the list on every save, not something the advisor sets directly.",
      },
    ],
  },
  {
    id: "will_residuary_recipient",
    nestedIn: { entity: "will", key: "residuaryRecipients" },
    label: "Residuary (remainder estate) recipient",
    tab: "wills",
    surface:
      "Wills → \"{grantorName}'s Will\" → Remainder estate → Primary / Contingent columns (src/components/forms/will-residuary-section.tsx, list rows via bequest-recipient-list.tsx with mode=\"residuary\")",
    table: "willResiduaryRecipients",
    routes: {
      create: "/wills",
      update: "/wills/[willId]",
    },
    createSchema: {
      module: "@/lib/schemas/wills",
      export: "willResiduaryRecipientSchema",
    },
    scenarioScoped: false,
    fields: [
      {
        key: "recipientKind",
        label: "Recipients",
        kind: "enum",
        enumValues: ["family_member", "external_beneficiary", "entity", "spouse"],
        required: true,
        notes:
          "Identical discriminated-union shape and rules as `will_bequest_recipients.recipientKind` — see that entity's notes for the full reference semantics (family_member excludes the client/spouse principal rows; spouse means the OTHER household principal and forces recipientId to null; ids are cross-referenced against this client's own rows).",
      },
      {
        key: "recipientId",
        label: "Recipients",
        kind: "uuid",
        required: true,
        nullable: true,
        notes:
          "Required and non-null unless recipientKind='spouse', where it must be null. Same superRefine rule as will_bequest_recipients.recipientId.",
      },
      {
        key: "tier",
        label: "Primary / Contingent",
        kind: "enum",
        enumValues: ["primary", "contingent"],
        required: false,
        defaultValue: "primary",
        notes:
          "Defaults to 'primary' (zod .default(\"primary\")). The UI only shows both a \"Primary\" and a \"Contingent\" column when the household has a spouse on file (primary column = used if the spouse survives the grantor; contingent = used if the spouse predeceases). With no spouse on file, only 'primary'-tier rows are shown/used and there's no tier picker at all.",
      },
      {
        key: "percentage",
        label: "(no static label — numeric input beside each recipient, with a trailing \"%\")",
        kind: "percent",
        required: true,
        range: { min: 0, max: 100 },
        notes:
          "Whole-number percent. Rows sharing the same `tier` on one will must sum to exactly 100 (±0.01) — enforced only when that tier has at least one row; an entirely empty tier (no primary rows, or no contingent rows) is valid and simply means \"no override, fall back to the default distribution order\" for that branch.",
      },
      {
        key: "sortOrder",
        label: "(not directly labeled — see notes)",
        kind: "number",
        required: true,
        range: { min: 0 },
        notes:
          "Positional only, recomputed within each tier from list order on save — not set directly by the advisor. Note the write handler serializes contingent rows AFTER primary rows into one combined array with sortOrder continuing across the boundary (src/components/forms/will-residuary-section.tsx `emit()`), even though the two tiers are edited as visually separate columns.",
      },
    ],
  },
];
