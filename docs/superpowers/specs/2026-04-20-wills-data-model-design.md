# Estate Planning — Spec 4a: Wills Data Model

**Date:** 2026-04-20
**Scope:** Data-only introduction of a will primitive.
Renumbered from the original item 4 decomposition during brainstorming —
see
[docs/design_handoff_estate_planning/PREREQUISITES.md](../../design_handoff_estate_planning/PREREQUISITES.md)
item 4.
**Chain:** 4a (wills data) → 4b (balance-sheet truth + first-death transfer)
→ 4c (second-death distribution) → 4d (grantor-trust survivorship).

## Goal

Give each spouse a structured will so that, at first and second death, the
engine can distribute individually-owned accounts (those not disposed of
by titling or beneficiary-designation) per the advisor's stated intent.

This spec is **data-only**. Wills attach to the engine input (`ClientData.wills`)
but no engine rule consumes them yet. Spec 4b is the first consumer.

## Non-goals

- Any engine behavior — 4b's job.
- UI-driven "preview who gets what at death" — requires the engine
  simulation in 4b/4c.
- Legal will document generation (future-work).
- Disclaimer / QTIP / credit-shelter bifurcation (future-work).
- Behavioral / time-based conditions ("if they reach 30") (future-work).
- Multi-asset bequests in a single clause (future-work).
- Non-account specific bequests — tangible personal property (future-work).
- Multiple wills / codicil versioning (future-work).
- Intestate defaults (future-work).

All future-work deferrals are tracked in
[docs/future-work/estate.md](../../future-work/estate.md).

## Precedence chain (informational, for spec 4b)

At the death of a grantor, assets distribute via:

1. **Titling** — joint-owned accounts pass 100% to the survivor via right
   of survivorship.
2. **Beneficiary designations** — retirement accounts, life insurance,
   TOD/POD accounts route per
   `beneficiary_designations` rows (built in item 1).
3. **Will** — everything individually-owned that isn't routed by (1) or
   (2) follows the grantor's will.

This spec only lands the data model for (3). The engine evaluation is 4b.

## Schema changes (additive)

Migration number: `0041_wills.sql`. Use the same drizzle-kit workaround
established in items 1–3 (verify via `information_schema.columns` after
`drizzle-kit migrate`; apply manually splitting on `--> statement-breakpoint`
if columns missing, then record the migration hash in
`drizzle.__drizzle_migrations`).

### `wills` (new)

One row per grantor per client household.

| column       | type                                    | notes                                                |
| ------------ | --------------------------------------- | ---------------------------------------------------- |
| id           | `uuid` pk                               |                                                      |
| client_id    | `uuid` not null → `clients(id)` cascade | tenant scoping                                       |
| grantor      | `enum('client' \| 'spouse')` not null   |                                                      |
| created_at / updated_at | `timestamp` not null         |                                                      |

Constraints:

- `UNIQUE (client_id, grantor)` — at most one will per spouse per household.

### `will_bequests` (new)

Ordered clause list per will.

| column      | type                                                          | notes                                         |
| ----------- | ------------------------------------------------------------- | --------------------------------------------- |
| id          | `uuid` pk                                                     |                                               |
| will_id     | `uuid` not null → `wills(id)` cascade                         |                                               |
| name        | `text` not null                                               | advisor-facing label                          |
| asset_mode  | `enum('specific' \| 'all_assets')` not null                   |                                               |
| account_id  | `uuid` → `accounts(id)` cascade, nullable                     | set iff `asset_mode='specific'`               |
| percentage  | `numeric(5,2)` not null                                       | 0.01 ≤ pct ≤ 100; % of account or % of residual |
| condition   | `enum('if_spouse_survives' \| 'if_spouse_predeceased' \| 'always')` not null | | |
| sort_order  | `int` not null                                                | drives execution + rearrangeable list         |
| created_at / updated_at | `timestamp` not null                              |                                               |

Constraints:

- CHECK: `(asset_mode='specific' AND account_id IS NOT NULL) OR (asset_mode='all_assets' AND account_id IS NULL)`.
- CHECK: `percentage BETWEEN 0.01 AND 100`.
- Index: `(will_id, sort_order)`.

### `will_bequest_recipients` (new)

Multi-recipient split within a clause.

| column          | type                                                              | notes                                   |
| --------------- | ----------------------------------------------------------------- | --------------------------------------- |
| id              | `uuid` pk                                                         |                                         |
| bequest_id      | `uuid` not null → `will_bequests(id)` cascade                     |                                         |
| recipient_kind  | `enum('family_member' \| 'external_beneficiary' \| 'entity' \| 'spouse')` not null | |
| recipient_id    | `uuid`, nullable                                                  | null iff `recipient_kind='spouse'`      |
| percentage      | `numeric(5,2)` not null                                           | recipients per bequest sum to 100       |
| sort_order      | `int` not null                                                    |                                         |
| created_at / updated_at | `timestamp` not null                                      |                                         |

Constraints:

- CHECK: `(recipient_kind='spouse' AND recipient_id IS NULL) OR (recipient_kind<>'spouse' AND recipient_id IS NOT NULL)`.
- FK validity for `recipient_id` against `family_members`, `external_beneficiaries`,
  or `entities` is enforced at the API layer, not in the DB (same pattern as
  `beneficiary_designations` in item 1).

### What is NOT enforced at the DB level

- Recipients within a bequest summing to exactly 100 → Zod.
- Cross-bequest over-allocation of a single account at one condition tier →
  surfaced as a **soft warning** at the API layer; not blocking.
- Cross-table FK validity for polymorphic `recipient_id` → API layer.

## Zod schemas

New file: `src/lib/schemas/wills.ts`.

Pattern-match the custom UUID regex from `src/lib/schemas/gifts.ts` (Zod v4
strict `.uuid()` rejects sequential test UUIDs used in tests).

```ts
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-.../i;
const uuid = z.string().regex(uuidRegex);

export const willBequestRecipientSchema = z.object({
  recipientKind: z.enum(['family_member','external_beneficiary','entity','spouse']),
  recipientId: uuid.nullable(),
  percentage: z.number().min(0.01).max(100),
  sortOrder: z.number().int().min(0),
}).refine(
  r => (r.recipientKind === 'spouse') === (r.recipientId === null),
  { message: "recipientId must be null iff recipientKind='spouse'" }
);

export const willBequestSchema = z.object({
  name: z.string().min(1).max(200),
  assetMode: z.enum(['specific','all_assets']),
  accountId: uuid.nullable(),
  percentage: z.number().min(0.01).max(100),
  condition: z.enum(['if_spouse_survives','if_spouse_predeceased','always']),
  sortOrder: z.number().int().min(0),
  recipients: z.array(willBequestRecipientSchema).min(1),
}).refine(
  b => (b.assetMode === 'specific') === (b.accountId !== null),
  { message: "accountId required iff assetMode='specific'" }
).refine(
  b => Math.abs(b.recipients.reduce((s,r) => s + r.percentage, 0) - 100) < 0.01,
  { message: "recipient percentages must sum to 100" }
);

export const willCreateSchema = z.object({
  grantor: z.enum(['client','spouse']),
  bequests: z.array(willBequestSchema).default([]),
});

export const willUpdateSchema = z.object({
  bequests: z.array(willBequestSchema).default([]),
});
```

## API routes

All routes tenant-gated via the existing `getClientForTenant` pattern
(same as items 1–3).

| Method | Path                                     | Purpose                                                |
| ------ | ---------------------------------------- | ------------------------------------------------------ |
| GET    | `/api/clients/[id]/wills`                | List both wills (≤2) with nested bequests + recipients |
| POST   | `/api/clients/[id]/wills`                | Create. 409 if `(client_id, grantor)` already exists   |
| GET    | `/api/clients/[id]/wills/[willId]`       | Fetch one will                                         |
| PATCH  | `/api/clients/[id]/wills/[willId]`       | Replace bequests (transactional)                       |
| DELETE | `/api/clients/[id]/wills/[willId]`       | Cascades to bequests + recipients                      |

### Update semantic

PATCH performs **full replace** of the bequest list, transactionally:

1. Delete all `will_bequests` where `will_id = :willId` (cascades to
   `will_bequest_recipients`).
2. Re-insert the incoming bequest list with fresh ids + recipient rows.

Chosen over a diff-apply strategy because item 1 established this
pattern for `beneficiary_designations` and items 2 and 3 reused it, and
the bequest list is small (usually < 10 per will) so the write overhead
is negligible. Callers provide `sortOrder` explicitly on every bequest
and recipient row (required by Zod).

### Cross-table validation at the API layer

For POST and PATCH, inside the same transaction as the write:

- Each specific bequest's `accountId` must belong to the same client.
- Each non-spouse recipient's `recipientId` must exist in its declared
  table (`family_members`, `external_beneficiaries`, or `entities`) and
  belong to the same client.

Any violation → 400 with the offending id, no mutation.

### Soft-warning response

The PATCH/POST response includes a non-blocking `warnings: string[]`
field. Populated when, for any account, the sum of specific-bequest
`percentage` at a single `condition` exceeds 100 — the advisor may be
mid-edit. Frontend surfaces the warning; save succeeds.

## Engine input loader

Attach to `ClientData`:

```ts
// src/engine/types.ts
export interface WillBequestRecipient {
  recipientKind: 'family_member' | 'external_beneficiary' | 'entity' | 'spouse';
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface WillBequest {
  id: string;
  name: string;
  assetMode: 'specific' | 'all_assets';
  accountId: string | null;
  percentage: number;
  condition: 'if_spouse_survives' | 'if_spouse_predeceased' | 'always';
  sortOrder: number;
  recipients: WillBequestRecipient[];
}

export interface Will {
  id: string;
  grantor: 'client' | 'spouse';
  bequests: WillBequest[];
}

// ClientData additions
wills?: Will[];
```

Loader wires into the same engine-input build step that items 1–3 hooked
into. One new query joining `wills` → `will_bequests` → `will_bequest_recipients`,
ordered by grantor, bequest.sort_order, recipient.sort_order. Attach to
`ClientData.wills`.

**No engine rule reads this yet** — spec 4b is the first consumer.

## UI — new Wills sub-tab

### Route

`src/app/(app)/clients/[id]/client-data/wills/page.tsx` (sibling of
`family/`, `investments/`, etc.). Nav entry matches whatever convention the
other `client-data` sub-tabs use.

Component extracted to `src/components/wills-panel.tsx` (keeps the page file
thin; matches the split pattern used by other sub-tabs).

### Layout

Two sub-sections stacked vertically, one per spouse (client, spouse). Each:

- Section header with grantor name and "+ Add bequest" button.
- Ordered list of bequest cards, drag-to-reorder via a ⋮⋮ handle.
- Each bequest card shows: name, asset (account name or "All other assets"),
  percentage, condition pill, recipient summary (`Child A (50%), Child B (50%)`),
  edit + delete affordances.
- Empty state when no bequests.

### Add/Edit bequest popup (modal)

Fields:

1. **Name** (text input, required)
2. **Asset selector** (dropdown): the client's accounts, plus an "All other assets" option at top
3. **Percentage** (number input, 0.01–100)
4. **Condition** (radio): "If spouse survives" / "If spouse predeceases" / "Always"
5. **Recipients** (repeater):
   - Row of `[recipient-kind select][recipient lookup][percentage input][✕]`
   - `+ Add recipient` button
   - Live "Total: N%" indicator, red when ≠ 100
6. Save (disabled until recipients sum to 100 + required fields filled)

Recipient lookup varies by kind:
- `family_member` → dropdown of client's family members
- `external_beneficiary` → dropdown of client's external beneficiaries (from item 1)
- `entity` → dropdown of client's entities (trusts)
- `spouse` → no lookup

### Drag-to-reorder

Use whatever DnD library the codebase already uses (or plain HTML5 drag if
none — grep for existing patterns). On drop, update `sortOrder` locally and
PATCH the full bequest list.

### Soft-warning banner

When any account has > 100% total claimed percentage across specific
bequests at any given condition, show an inline warning per over-bequeathed
account (non-blocking; uses the API `warnings[]` response).

## Testing plan

| Layer                              | Coverage                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Unit (zod)                         | Recipient sum validation; `assetMode` ↔ `accountId` coupling; `recipient_kind` ↔ `recipientId` coupling                     |
| API                                | CRUD happy paths; 404s; 409 on duplicate `(client_id, grantor)`; transactional PATCH replace-all                            |
| Tenant isolation (live DB)         | Cross-firm fetch/patch/delete rejected; cross-client `accountId` / `recipientId` / `willId` rejected; delete-client cascade |
| Engine-input snapshot              | DB → `ClientData.wills` end-to-end                                                                                          |
| Component                          | Bequest-popup form: recipient-sum gating, `assetMode` toggle hides/shows account selector, condition radio                  |

**No engine-behavior tests** — no engine behavior exists yet.

Live-DB tenant test file must include the inline `.env.local` loader at the
top (vitest doesn't auto-load — pattern established in items 1, 2, 3).

## Gotchas carried from items 1–3

- **drizzle-kit migrate silently skips on neon-http.** Verify column
  creation via `information_schema.columns` post-migrate; apply manually
  splitting on `--> statement-breakpoint` if columns missing; record hash
  in `drizzle.__drizzle_migrations`.
- **Zod v4 `.uuid()`** rejects sequential test UUIDs → use the custom regex.
- **`.env.local`** not auto-loaded by vitest → inline loader at top of
  tenant-isolation test.
- **Next.js in this repo ≠ training data** — read
  `node_modules/next/dist/docs/` before App Router work.

## Downstream consumers (not built here)

- Spec 4b — first-death transfer reads `ClientData.wills`, filters by
  grantor's spouse-survivorship condition, and distributes individually-owned
  accounts not claimed by titling or beneficiary designation.
- Spec 4c — same mechanism for second-death distribution.
- Future "generate legal will document" scope (when taken on) starts from
  this same structured data.
