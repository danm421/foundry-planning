# Estate Planning — Item 1: Family Members as Owners / Beneficiaries

**Date:** 2026-04-20
**Scope:** Item 1 only from
[docs/design_handoff_estate_planning/PREREQUISITES.md](../../design_handoff_estate_planning/PREREQUISITES.md).
Items 2–8 are explicitly out of scope.

## Goal

Extend the data model so children, grandchildren, and charities can be
designated as **owners** (on accounts) and/or **beneficiaries** (on
accounts and trusts). Today `family_members` rows are informational
only; this work turns them into first-class owning/receiving parties.

Downstream consumers, designed-for but not built here:

- **Item 2 (trust data model):** references designations as remainder
  beneficiaries.
- **Item 4 (death-sequence events):** distributes assets at second
  death.
- **Design beneficiary strip & Impact & Beneficiaries Sankey:** both
  render off this model.

## Non-goals

- Migrating the legacy `entities.beneficiaries` JSON payload (item 2).
- Any engine behavior change (item 4 wires it up).
- Charity-specific metadata (EIN, address, etc.).
- DB-level SUM(percentage)=100 enforcement.
- UI canvas / flowchart / Sankey / projection panel.
- Scenario switcher.

## Schema changes (additive)

### `external_beneficiaries` (new)

Named non-family parties. Kept separate from `family_members`
(different semantics) and from `entities` (which models client-owned
structures like trusts/LLCs).

| column            | type                                     | notes                                              |
| ----------------- | ---------------------------------------- | -------------------------------------------------- |
| id                | `uuid` pk                                |                                                    |
| client_id         | `uuid` not null → `clients(id)` cascade  | tenant scoping                                     |
| name              | `text` not null                          | e.g., "Stanford University"                        |
| kind              | `enum('charity' \| 'individual')` not null default `'charity'` | lets us add non-family individuals later          |
| notes             | `text`                                   |                                                    |
| created_at / updated_at | `timestamp` not null                |                                                    |

### `beneficiary_designations` (new)

Polymorphic on both target (account or trust) and beneficiary
(family member or external).

| column                  | type                                              | notes                                          |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------- |
| id                      | `uuid` pk                                         |                                                |
| client_id               | `uuid` not null → `clients(id)` cascade           | denormalized for tenant queries                |
| target_kind             | `enum('account' \| 'trust')` not null             |                                                |
| account_id              | `uuid` → `accounts(id)` cascade, nullable         | set iff `target_kind = 'account'`              |
| entity_id               | `uuid` → `entities(id)` cascade, nullable         | set iff `target_kind = 'trust'`                |
| tier                    | `enum('primary' \| 'contingent')` not null        |                                                |
| family_member_id        | `uuid` → `family_members(id)` cascade, nullable   |                                                |
| external_beneficiary_id | `uuid` → `external_beneficiaries(id)` cascade, nullable |                                          |
| percentage              | `numeric(5,2)` not null                           | 0 < pct ≤ 100                                  |
| sort_order              | `int` not null default 0                          |                                                |
| created_at / updated_at | `timestamp` not null                              |                                                |

Constraints:

- CHECK: exactly one of `account_id`, `entity_id` is non-null, matching
  `target_kind`.
- CHECK: exactly one of `family_member_id`, `external_beneficiary_id`
  is non-null.
- Indexes: `(client_id, target_kind, account_id)` and
  `(client_id, target_kind, entity_id)`.

### `accounts.owner_family_member_id` (new column)

`uuid` → `family_members(id)` on delete set null, nullable. Supports
UTMA / custodial accounts.

Resolver precedence (documented as a schema comment and implemented in
`resolveAccountOwner`): `owner_entity_id` > `owner_family_member_id` >
`owner` enum.

### Legacy column

`entities.beneficiaries` (jsonb) is left in place. Add a comment
`-- deprecated: superseded by beneficiary_designations`. Item 2 will
decide reconciliation.

## Validation helpers (`src/lib/beneficiaries/`)

Pure functions, unit-tested with vitest.

```ts
type DesignationInput = {
  tier: 'primary' | 'contingent';
  percentage: number; // 0 < pct ≤ 100
  familyMemberId?: string;
  externalBeneficiaryId?: string;
};

validateBeneficiarySplit(ds: DesignationInput[]):
  { ok: true } | { ok: false; errors: string[] };
```

Rules:

- Each non-empty tier must sum to exactly 100 (±0.01 tolerance).
- Each percentage must be `> 0` and `≤ 100`.
- No duplicate `(tier, family_member_id|external_beneficiary_id)` pair.
- Zero designations total is valid (no beneficiaries set).
- Only one tier populated is valid; the unpopulated tier is not
  required to sum to 100.

```ts
resolveAccountOwner(account: {
  owner: 'client' | 'spouse' | 'joint';
  ownerEntityId: string | null;
  ownerFamilyMemberId: string | null;
}):
  | { kind: 'entity'; id: string }
  | { kind: 'family_member'; id: string }
  | { kind: 'individual'; who: 'client' | 'spouse' | 'joint' };
```

Precedence: entity > family_member > individual enum.

## Zod schemas (`src/lib/schemas/beneficiaries.ts`)

- `externalBeneficiarySchema` — create/update.
- `beneficiaryDesignationSchema` — discriminated union on `target_kind`
  and on beneficiary ref; enforces the "exactly one" rules at the
  parser level.
- `beneficiarySetSchema` — an array of designations for a single
  target; `.superRefine` pipes through `validateBeneficiarySplit`.

## API routes

All follow the pattern in
[src/app/api/clients/[id]/entities/](../../../src/app/api/clients/[id]/entities/)
and
[src/app/api/clients/[id]/accounts/](../../../src/app/api/clients/[id]/accounts/).
Each route opens with `getOrgId()` + firm-scoped client lookup.

- `GET POST /api/clients/[id]/external-beneficiaries`
- `PATCH DELETE /api/clients/[id]/external-beneficiaries/[beneficiaryId]`
- `GET PUT /api/clients/[id]/accounts/[accountId]/beneficiaries` — PUT
  replaces the full set in a single transaction.
- `GET PUT /api/clients/[id]/entities/[entityId]/beneficiaries` — same
  shape for trust remainder; PUT is 400 for non-trust entities.
- Owner override on an account is set via the existing account `PATCH`
  route, extended to accept `ownerFamilyMemberId`. Only one of
  `ownerEntityId` / `ownerFamilyMemberId` may be sent non-null in the
  same request.

## UI — Family page extension

File: [src/app/(app)/clients/[id]/client-data/family/page.tsx](../../../src/app/(app)/clients/[id]/client-data/family/page.tsx)
and [src/components/family-view.tsx](../../../src/components/family-view.tsx).

Add, in existing Client Data form style (no canvas work):

1. **External Beneficiaries** section below Family Members — same table
   look. Columns: Name, Kind (charity / individual), Notes. Add /
   edit / delete rows.
2. **Per-account beneficiaries**: on each account row (loaded into the
   page), an inline expander with two tier sections (Primary /
   Contingent). Each tier has rows of `[beneficiary picker, %]` plus
   "Add row". Inline sum indicator goes red when ≠ 100. Save posts to
   the PUT route.
3. **Per-trust remainder beneficiaries**: same expander on each trust
   entity row.
4. **Account owner override**: an additional picker on the account
   editor — "Owned by family member" — disabled when an entity owner
   is set. Visible only when the existing account editor on this page
   covers the account; if the account editor lives elsewhere, the
   picker is added in that same place. To-be-confirmed in the
   implementation plan.

Quality bar: functional and consistent with existing Client Data
forms. No design-handoff canvas work.

## Engine — data-loading only

No behavior changes this session.

- Extend the engine input loader to fetch designations and attach them
  to each account / trust. Source location TBD during the plan (likely
  wherever `buildProjectionInput` or equivalent lives).
- Extend [src/engine/types.ts](../../../src/engine/types.ts):
  - Add optional `beneficiaries?: BeneficiaryRef[]` on account and
    trust input types.
  - Add optional `ownerFamilyMemberId?: string` on account input types.
- Not consumed anywhere this session. Item 4 wires to death events.

## Tests

- Vitest unit tests for `validateBeneficiarySplit` — empty set, single
  tier, ±0.01 tolerance, duplicates, >100, <100, 0% rejected.
- Vitest unit tests for `resolveAccountOwner` precedence.
- Vitest tests for the Zod discriminated unions (both target-side and
  beneficiary-side "exactly one" rules).
- Tenant isolation coverage in the style of
  [src/__tests__/tenant-isolation.test.ts](../../../src/__tests__/tenant-isolation.test.ts):
  both `external_beneficiaries` and `beneficiary_designations` (cannot
  read / list / update / delete across firms; cannot designate a
  family member or account from firm B while authenticated as firm A).

## Migration plan

- One new Drizzle migration: adds `external_beneficiaries`,
  `beneficiary_designations`, the two new enums, the
  `accounts.owner_family_member_id` column, and the CHECK constraints
  and indexes.
- No data backfill required. Existing accounts have no designations;
  this is the expected default.
- Additive only — no drops, no renames, no type changes.

## Deferred (add to `docs/FUTURE_WORK.md` when spec merges)

- Migrate legacy `entities.beneficiaries` JSON → designation rows
  (belongs to item 2). _Why deferred:_ avoid pre-building trust model
  changes; item 2 will reconcile.
- Charity metadata (EIN, address). _Why deferred:_ no consumer yet.
- DB-level SUM=100 enforcement via deferred trigger. _Why deferred:_
  API + helper validation is sufficient for v1.
- Polymorphic unified-owner refactor on `accounts`. _Why deferred:_
  out of scope (backwards-incompatible). Additive column added instead.
