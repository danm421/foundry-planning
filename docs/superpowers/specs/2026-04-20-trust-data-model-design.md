# Estate Planning — Item 2: Trust Data Model

**Date:** 2026-04-20
**Scope:** Item 2 from
[docs/design_handoff_estate_planning/PREREQUISITES.md](../../design_handoff_estate_planning/PREREQUISITES.md)
(section 5: "Trust data model is too thin"). Items 3–8 remain out of
scope.

## Goal

Extend the `entities` row for trusts with the fields the Estate
Planning report needs: a **sub-type enum**, an **irrevocability flag**,
a **trustee free-text field**, and a **per-trust
exemption-consumed** decimal. Persist and expose to the engine input;
no engine behavior change this session.

Downstream consumers (designed-for, not built here):

- **Item 3 (gift-tax ledger):** will own per-grantor exemption-used
  accounting. This session ships a single per-trust rollup that item
  3 can either keep-syncing or deprecate in a follow-up.
- **Items 4–5 (death-sequence events, estate tax):** will read
  `isIrrevocable` to decide in- vs out-of-estate at death.
- **Design trust card:** uses sub-type (as a tag pill), trustee (as a
  sub-row), exemption-consumed (as a footer).

## Non-goals

- Engine behavior change — `isIrrevocable` is persisted but no
  existing engine rule flips on it. Revocable trusts still use the
  current "entity-owned → out of estate" rollup. Balance-sheet
  inclusion of revocable trusts lands later.
- Migrating legacy `entities.beneficiaries` jsonb → `beneficiary_designations`.
- Trustee as a structured reference — free text suffices for display.
- Multi-grantor exemption-used accounting — item 3 territory.
- UI canvas / flowchart / projection panel work.

## Schema changes (additive)

### `trust_sub_type` enum (new)

Ten values, ordered in the enum as listed:

```
revocable, irrevocable, ilit, slat, crt, grat, qprt, clat, qtip, bypass
```

### New columns on `entities`

| column              | type                                                   | notes                                                                 |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| trust_sub_type      | `trust_sub_type` enum, nullable                        | Required when `entity_type = 'trust'`; forbidden otherwise (API rule) |
| is_irrevocable      | `boolean`, nullable                                    | Required when `entity_type = 'trust'`; forbidden otherwise (API rule) |
| trustee             | `text`, nullable                                       | Display-only free text. Co-trustees as comma-separated string         |
| exemption_consumed  | `numeric(15,2)` not null default `0`                   | Used only on trust rows; non-trust rows stay at 0                     |

### Consistency rule

`is_irrevocable` must be consistent with `trust_sub_type`:

- `trust_sub_type = 'revocable'` → `is_irrevocable = false`
- All other sub-types (`irrevocable`, `ilit`, `slat`, `crt`, `grat`,
  `qprt`, `clat`, `qtip`, `bypass`) → `is_irrevocable = true`

Enforced at the API / Zod layer via a pure helper
`deriveIsIrrevocable(subType)`. Not enforced in the DB (CHECK
constraints across two columns are awkward and we already trust API
validation for similar cross-field rules).

### Legacy column

`entities.beneficiaries` jsonb stays in place with its existing
DEPRECATED comment. Item 1 already routes reads through
`beneficiary_designations`.

## Validation helpers

New module: `src/lib/entities/trust.ts`. Pure functions, unit-tested.

```ts
export const TRUST_SUB_TYPES = [
  "revocable",
  "irrevocable",
  "ilit",
  "slat",
  "crt",
  "grat",
  "qprt",
  "clat",
  "qtip",
  "bypass",
] as const;
export type TrustSubType = (typeof TRUST_SUB_TYPES)[number];

export const REVOCABLE_SUB_TYPES = new Set<TrustSubType>(["revocable"]);

export function deriveIsIrrevocable(subType: TrustSubType): boolean {
  return !REVOCABLE_SUB_TYPES.has(subType);
}
```

Rules tested:

- Each of the ten enum values maps to the correct boolean.
- Only `revocable` is revocable.

## Zod schemas

Create `src/lib/schemas/entities.ts` (the file may not yet exist —
entity routes currently validate ad-hoc). Export:

- `entityCreateSchema` — base fields already present in the POST
  route, plus `trustSubType`, `isIrrevocable`, `trustee`,
  `exemptionConsumed`. `.superRefine`s:
  - If `entityType !== 'trust'`: all four new fields must be
    nullish (or `exemptionConsumed === 0`).
  - If `entityType === 'trust'`: `trustSubType` and `isIrrevocable`
    are required, and must satisfy
    `deriveIsIrrevocable(trustSubType) === isIrrevocable`.
- `entityUpdateSchema` — same shape, all fields optional. Same
  `.superRefine` logic runs against the combined new+old row; easiest
  implementation is to validate the request body alone and let the
  route merge against the persisted row before a final consistency
  check.

## API routes

Extend existing routes; no new routes.

- [src/app/api/clients/[id]/entities/route.ts](../../../src/app/api/clients/%5Bid%5D/entities/route.ts)
  (`POST`):
  1. Run `entityCreateSchema.safeParse(body)`; 400 on fail.
  2. Persist the four new fields alongside existing ones.
  3. Existing default-checking-account creation logic is untouched.
- [src/app/api/clients/[id]/entities/[entityId]/route.ts](../../../src/app/api/clients/%5Bid%5D/entities/%5BentityId%5D/route.ts)
  (`PUT`):
  1. Fetch the persisted row (firm-scoped).
  2. Merge body over persisted row; validate combined against
     `entityCreateSchema` (same rules as create — final merged state
     must be consistent).
  3. If the merged `entityType !== 'trust'`, null out the trust-only
     fields and reset `exemptionConsumed` to 0 on write.
  4. Persist.

Firm-scoping, error envelope, and `Unauthorized` handling stay
exactly as in existing handlers.

## UI — extend the entity editor

File: [src/components/family-view.tsx](../../../src/components/family-view.tsx).

Inside the existing entity create/edit form (rendered for each
entity row plus the "add entity" form):

1. **Sub-type `<select>`** — ten `<option>` elements in the enum
   order. Visible only when `entityType === 'trust'`. `onChange`
   sets `trustSubType` **and** derives `isIrrevocable` via the
   helper; `isIrrevocable` is not exposed as a separate input.
2. **Trustee `<input type="text">`** — visible only when
   `entityType === 'trust'`. Placeholder: "e.g. Linda, or Fidelity
   Trust Co.".
3. **Exemption-consumed `<input type="number">`** — visible only
   when `entityType === 'trust'`. Label: "Lifetime exemption used by
   this trust". Step 1000, min 0.

Render order: below the existing Grantors list, above Notes. Styling
matches the surrounding `family-view.tsx` dark-theme conventions.

On submit, the form sends all four new fields whenever
`entityType === 'trust'`; otherwise it omits them (server will ignore
or null them per the API rule).

## Engine — data-loading only

- Extend `EntitySummary` in
  [src/engine/types.ts](../../../src/engine/types.ts):

  ```ts
  export interface EntitySummary {
    id: string;
    includeInPortfolio: boolean;
    isGrantor: boolean;
    beneficiaries?: BeneficiaryRef[];
    // Item 2 additions (data-only; no engine rule reads these yet):
    trustSubType?: TrustSubType;
    isIrrevocable?: boolean;
    trustee?: string;
    exemptionConsumed?: number;
  }
  ```

- Extend the `entities` mapping in
  [src/app/api/clients/[id]/projection-data/route.ts](../../../src/app/api/clients/%5Bid%5D/projection-data/route.ts)
  to attach the new fields. No behavior change.

## Tests

- Vitest: `deriveIsIrrevocable` — one assertion per sub-type.
- Vitest: `entityCreateSchema` — cover trust-required fields,
  non-trust-forbidden fields, sub-type/irrevocable consistency
  rejection.
- Existing structural
  [src/__tests__/tenant-isolation.test.ts](../../../src/__tests__/tenant-isolation.test.ts)
  continues to pass without changes (routes already firm-scope).
- No new behavioral tenant-isolation test is required: this session
  only adds fields inside routes that already have live-DB coverage
  in item 1's
  [src/__tests__/beneficiaries-tenant-isolation.test.ts](../../../src/__tests__/beneficiaries-tenant-isolation.test.ts).

## Migration plan

- One new Drizzle migration: `0039_trust_data_model.sql`. Creates the
  `trust_sub_type` enum and adds the four new columns to `entities`.
- Backfill: `exemption_consumed` defaults to `0`. The other three
  nullable columns stay NULL for existing rows; that's the correct
  default — existing trust rows don't have an advisor-entered
  sub-type yet, and displaying them in the Entities UI will prompt
  the advisor to set one on next edit.
- Additive only — no drops, renames, or type changes on existing
  columns.

## Deferred (add to `docs/FUTURE_WORK.md` on merge)

- Balance-sheet rule: revocable-trust accounts roll into in-estate
  household totals. _Why deferred:_ engine behavior change; lands
  with item 4 (death-sequence) or as a small follow-up.
- Migrate legacy `entities.beneficiaries` jsonb →
  `beneficiary_designations`. _Why deferred:_ still unowned;
  `beneficiaries` jsonb currently has no active writer path beyond
  the entity POST route, so cleanup is low-urgency.
- Per-grantor exemption-used ledger. _Why deferred:_ item 3 owns this;
  single rollup on the entity row is enough for the design card.
- Trustee as structured FK / multi-trustee table. _Why deferred:_
  nothing reads trustee except the UI card; free text is correct for
  v1 fidelity.
