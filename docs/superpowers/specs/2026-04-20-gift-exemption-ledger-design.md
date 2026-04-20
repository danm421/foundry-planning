# Estate Planning — Item 3: Gift Transaction Primitive + Exemption Ledger

**Date:** 2026-04-20
**Scope:** Item 3 from
[docs/design_handoff_estate_planning/PREREQUISITES.md](../../design_handoff_estate_planning/PREREQUISITES.md)
(section 2: "Gift-tax / exemption-usage ledger"). Items 4–8 remain
out of scope.

## Goal

Add a **gift** primitive (a year-indexed transaction moving value
from a grantor to a trust / family member / external party) and
**derived per-grantor lifetime-exemption ledger** that feeds the
trust card's "Uses exemption · $X / $Y" footer. Persist data; expose
it to engine input; no engine behavior change.

Downstream consumers (designed for, not built here):

- **Items 4–5 (death-sequence + estate tax):** will read the ledger
  to reduce the grantor's household balance and to compute the
  exemption-available figure at second death.
- **Design trust card footer:** already specified in the handoff;
  this session renders it.

## Non-goals

- Engine behavior change — gifts persist and load into engine input
  but no existing engine rule reduces balance sheets or applies tax
  rules. Balance-sheet reduction + estate-tax math land with item 4+.
- Gift-splitting elections beyond simple 50/50 on `grantor = 'joint'`.
- GST tax on skip-person gifts (grandchildren).
- ILIT three-year look-back on gift-of-policy scenarios.
- Migrating `entities.exemption_consumed` opening balances → gift
  rows. Handled as a follow-up.
- Estate tax / lifetime-cap enforcement (items 4–5).

## Schema changes (additive)

### `gifts` (new table)

| column                            | type                                                          | notes                                                                 |
| --------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| id                                | `uuid` pk                                                     |                                                                       |
| client_id                         | `uuid` not null → `clients(id)` cascade                       | tenant scoping (firm-scoped via client)                               |
| year                              | `integer` not null                                            | calendar year the gift occurs                                         |
| amount                            | `numeric(15,2)` not null                                      | must be > 0 (CHECK)                                                   |
| grantor                           | `owner` enum (`client` \| `spouse` \| `joint`)                | reuses existing enum; `joint` splits 50/50 in the ledger              |
| recipient_entity_id               | `uuid` → `entities(id)` cascade, nullable                     | exactly one of the three recipient_*_id columns is non-null (CHECK)   |
| recipient_family_member_id        | `uuid` → `family_members(id)` cascade, nullable               |                                                                       |
| recipient_external_beneficiary_id | `uuid` → `external_beneficiaries(id)` cascade, nullable       |                                                                       |
| use_crummey_powers                | `boolean` not null default `false`                            | only meaningful when recipient is an irrevocable trust                |
| notes                             | `text`, nullable                                              |                                                                       |
| created_at / updated_at           | `timestamp` not null                                          |                                                                       |

CHECK constraints:

- Exactly one recipient non-null: `(recipient_entity_id IS NOT NULL AND recipient_family_member_id IS NULL AND recipient_external_beneficiary_id IS NULL) OR (recipient_entity_id IS NULL AND recipient_family_member_id IS NOT NULL AND recipient_external_beneficiary_id IS NULL) OR (recipient_entity_id IS NULL AND recipient_family_member_id IS NULL AND recipient_external_beneficiary_id IS NOT NULL)`.
- `amount > 0`.

Indexes:

- `(client_id, year)`
- `(client_id, grantor, year)`

### `tax_year_parameters.gift_annual_exclusion` (new column)

- Type: `numeric(10,2)` **not null**.
- Seed with known IRS values in the migration:
  - 2024 → `18000`
  - 2025 → `19000`
  - 2026 → `19000`
- For any existing row the migration backfills, if the row's year
  predates 2024, use `18000` as a reasonable fallback; the helper
  will only read for years with gifts in them. Existing seeds past
  2026 get inflation-projected by the seed-tax-data script on its
  next run; this session does NOT re-run the seeder.

### `entities.exemption_consumed` (no schema change)

Column stays; no data migration. UI label updates from
"Lifetime exemption used by this trust" to "Opening balance
(legacy)" — see Section 5. Trust card footer displays
`opening_balance + sum(gifts)`.

## Pure helpers (`src/lib/gifts/`)

Three pure functions with unit tests. No I/O, no DB.

### `computeGiftTaxTreatment(gift, context): GiftTreatment`

```ts
type Gift = {
  amount: number;
  useCrummeyPowers: boolean;
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
};

type Context = {
  entity?: { isIrrevocable: boolean; entityType: "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other" };
  external?: { kind: "charity" | "individual" };
  annualExclusionAmount: number; // for the gift's year
  crummeyBeneficiaryCount: number; // count of primary designations on the recipient trust; ignored unless Crummey is on
};

type GiftTreatment = {
  lifetimeUsed: number;
  annualExcluded: number;
  charitableExcluded: number;
};
```

Rules (throw on programmer error; API layer rejects user errors):

| Recipient                                           | Crummey | Result                                                                     |
| --------------------------------------------------- | ------- | -------------------------------------------------------------------------- |
| Irrevocable trust (`entity.isIrrevocable === true`) | off     | `lifetime = amount`, `annual = 0`, `charity = 0`                           |
| Irrevocable trust                                   | on      | `annual = min(amount, exclusion × beneficiaryCount); lifetime = amount - annual; charity = 0` |
| Family member                                       | (n/a)   | `annual = min(amount, exclusion); lifetime = amount - annual; charity = 0` |
| External individual                                 | (n/a)   | same as family member                                                      |
| External charity                                    | (n/a)   | `lifetime = 0`, `annual = 0`, `charity = amount`                           |
| Revocable trust                                     | —       | **throws** — API rejects                                                   |
| Non-trust entity (LLC, foundation, etc.)            | —       | **throws** — API rejects                                                   |

### `resolveAnnualExclusion(year, taxYearRows, inflationRate): number`

- If `taxYearRows` has a row for `year`, return its `gift_annual_exclusion`.
- Else: find the latest-known year `Y` in `taxYearRows`, compute
  `projected = Y.gift_annual_exclusion × (1 + inflationRate) ^ (year - Y)`,
  return `Math.round(projected / 1000) * 1000`.
- If `taxYearRows` is empty: fall back to `18000` (spec baseline —
  matches the lowest historical seed).

### `computeExemptionLedger(gifts, context): LedgerEntry[]`

```ts
type LedgerEntry = {
  grantor: "client" | "spouse";
  year: number;
  lifetimeUsedThisYear: number;
  cumulativeLifetimeUsed: number; // through end of year
};
```

- For each gift, call `computeGiftTaxTreatment` → get `lifetimeUsed`.
- If `grantor = "joint"`, split 50/50 to `client` and `spouse`
  entries.
- Group by `(grantor, year)`; sum `lifetimeUsed` → `lifetimeUsedThisYear`.
- Compute `cumulativeLifetimeUsed` as a running total per grantor
  across years.
- Return entries sorted by `(grantor, year)`.

## Zod schemas (`src/lib/schemas/gifts.ts`)

- `giftCreateSchema` — base fields, `.superRefine`:
  - Exactly one of `recipientEntityId`, `recipientFamilyMemberId`,
    `recipientExternalBeneficiaryId` present.
  - `amount > 0`.
  - `year` in `1900..2200` (guards nonsense input).
- `giftUpdateSchema` — partial, same "exactly-one" rule when any
  recipient field is present in the patch.

## API routes

All follow the tenancy + error-envelope patterns of the item 1
beneficiaries routes.

- `GET    /api/clients/[id]/gifts` — list, `ORDER BY year ASC, createdAt ASC`.
- `POST   /api/clients/[id]/gifts` — create. Validates:
  - Zod passes.
  - The referenced recipient belongs to the same client (fetch it;
    cross-firm injection returns 400).
  - If `recipientEntityId` is set, the entity must be a trust with
    `isIrrevocable = true` or a non-trust entity is rejected (400,
    message: "Recipient must be an irrevocable trust, family member,
    or external beneficiary").
  - Revocable trust recipient → 400 (message: "Gifts to revocable
    trusts are not completed gifts; no exemption is used").
  - No back-propagation to `entities.exemption_consumed` — the two
    stay independent.
- `PATCH  /api/clients/[id]/gifts/[giftId]` — partial update with
  the same cross-tenant + recipient-kind validations when relevant
  fields change.
- `DELETE /api/clients/[id]/gifts/[giftId]` — plain delete.

No dedicated `/gifts/ledger` endpoint. Ledger is computed on-demand
on whichever side consumes (UI trust card, projection-data loader
in a future session).

## UI

File: [src/components/family-view.tsx](../../../src/components/family-view.tsx).

### Gifts section (new)

Render below the External Beneficiaries section. Table columns:

- Year, Grantor (client/spouse/joint), Amount, Recipient (resolved
  name — e.g., "Smith SLAT", "Tom Jr.", "Stanford"), Crummey (✓ when
  on, blank otherwise), Notes, Actions (Edit / Delete).

"Add Gift" button opens an inline form:

- Year — `<input type="number" min=1900 max=2200>`.
- Grantor — `<select>` with `client` / `spouse` / `joint`.
- Amount — `<input type="number" min=0 step=1000>`.
- Recipient — two-level select. First `<select>` picks recipient
  kind: Trust / Family member / External. Second `<select>` lists
  items of that kind (pulled from existing `initialEntities.filter(e => e.entityType === "trust")`,
  `initialMembers`, `initialExternalBeneficiaries`). Setting the
  second select clears the other two FKs.
- Crummey toggle — `<input type="checkbox">` visible only when the
  resolved recipient entity has `isIrrevocable = true`.
- Notes — free text.

Save → POST `/api/clients/{clientId}/gifts` with exactly one
`recipient_*_id` set.

### Trust card footer (new)

Inside each trust `<details>` expander (added in item 1), render:

```
Uses exemption · ${formatM(opening + lifetimeUsedForThisTrust)} / $13.99M
```

Where:

- `opening = parseFloat(entity.exemptionConsumed)`.
- `lifetimeUsedForThisTrust = sum of computeGiftTaxTreatment(g).lifetimeUsed` across gifts whose `recipientEntityId === entity.id`.
- The $13.99M cap is a module-level constant `LIFETIME_EXEMPTION_2026 = 13_990_000` in `family-view.tsx` — FUTURE_WORK to source from `tax_year_parameters` when portability/DSUE work lands.

### Relabel of `exemption_consumed` input

In the EntityDialog, change the existing input's label from
"Lifetime exemption used by this trust" to "Opening balance (legacy)"
and add a helper line: "Historical exemption already used before
you started tracking individual gifts. Gifts added below stack on
top."

All styling matches existing dark-theme conventions.

## Engine — data-loading only

- Extend `src/engine/types.ts`:

  ```ts
  export interface Gift {
    id: string;
    year: number;
    amount: number;
    grantor: "client" | "spouse" | "joint";
    recipientEntityId?: string;
    recipientFamilyMemberId?: string;
    recipientExternalBeneficiaryId?: string;
    useCrummeyPowers: boolean;
  }
  ```

  Add to `ClientData`: `gifts?: Gift[]`.

- Extend [src/app/api/clients/[id]/projection-data/route.ts](../../../src/app/api/clients/%5Bid%5D/projection-data/route.ts)
  to load gifts and include them on the returned payload.

- No engine code reads `gifts` this session.

## Tests

- Vitest: `computeGiftTaxTreatment` — one test per rule row
  (irrevocable-trust + Crummey off/on; family member; external
  individual; external charity; revocable-trust throws; non-trust
  entity throws). Including Crummey-with-N-beneficiaries math.
- Vitest: `resolveAnnualExclusion` — seeded-year hit; unseeded year
  projected + rounded; empty-rows fallback.
- Vitest: `computeExemptionLedger` — single-gift single-grantor,
  multi-year cumulative, joint-split 50/50, multiple grantors.
- Vitest: `giftCreateSchema` — exactly-one-recipient; amount>0;
  year out of range; Zod-level happy path.
- Tenant-isolation: extend
  [src/__tests__/beneficiaries-tenant-isolation.test.ts](../../../src/__tests__/beneficiaries-tenant-isolation.test.ts)
  (or a new sibling `gifts-tenant-isolation.test.ts`) with:
  - Firm B cannot GET firm A's gifts (404).
  - Firm B cannot POST a gift to firm A's client (404).
  - Firm A cannot POST a gift with firm B's family member /
    entity / external beneficiary as the recipient (400).
  - POST with revocable-trust recipient → 400.

## Migration plan

- One new Drizzle migration: `0040_gifts.sql`. Creates the `gifts`
  table (with CHECK constraints + indexes) and adds
  `tax_year_parameters.gift_annual_exclusion` with a seeded backfill.
- Seeded values in the migration SQL:
  `UPDATE tax_year_parameters SET gift_annual_exclusion = 18000 WHERE year <= 2024;`
  `UPDATE tax_year_parameters SET gift_annual_exclusion = 19000 WHERE year IN (2025, 2026);`
  (Use `18000` for rows ≤ 2024 since pre-2024 values are not in
  scope; any unseeded row after 2026 will be handled by the
  `resolveAnnualExclusion` helper at read time.)
- Additive only. No drops, renames, or type changes.

## Deferred (add to `docs/FUTURE_WORK.md` on merge)

- **Engine: gifts reduce grantor household balance in gift year.**
  _Why deferred:_ engine behavior; lands with item 4/5.
- **Estate-tax + lifetime-cap enforcement + portability / DSUE.**
  _Why deferred:_ items 4–5 territory.
- **Migrate `entities.exemption_consumed` opening balances → gift
  rows and drop the column.** _Why deferred:_ pragmatic dual
  representation; migration can happen after item 4 wires the
  ledger into engine math.
- **Gift-splitting elections beyond 50/50 joint.** _Why deferred:_
  rarely used outside gift-to-spouse-of-grantor edge cases.
- **GST tax tracking on skip-person gifts.** _Why deferred:_
  separate generational-skipping-tax model; item 4/5 at earliest.
- **ILIT three-year look-back rule on gift-of-policy.** _Why
  deferred:_ item 7 (life-insurance primitives) owns this.
- **`LIFETIME_EXEMPTION_2026` sourced from `tax_year_parameters`
  + sunset handling.** _Why deferred:_ sunset logic is its own
  concern; UI constant is enough to render the trust-card footer.
