# Deduction Types — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**FUTURE_WORK item:** "Deduction types (IRA/401k/charitable/SALT)" _(P7 E4 L5)_

## Overview

Wire real above-line and itemized deductions into the bracket tax engine — replacing the v1 hardcoded `aboveLineDeductions: 0` and `itemizedDeductions: 0` stubs. Two sources of deductions:

1. **Auto-derived above-line** from existing `savings_rules` rows whose target account is a traditional IRA or 401k. Already in the data model; just needs to be summed and passed to the engine.
2. **Explicit itemized entries** in a new `client_deductions` table covering charitable cash, charitable non-cash, SALT (statutorily capped at $10k), mortgage interest, and a generic "other itemized" catch-all.

A new "Deductions" subtab in Client Data lets advisors view auto-derived totals and CRUD itemized line items. The bracket engine becomes meaningfully more accurate for any client with retirement contributions, charitable giving, or SALT — which is most HNW clients.

Bracket mode also becomes the default for new clients (and existing clients flip via migration), so the new accuracy reaches users without manual opt-in.

## MVP Scope

**In scope:**
- Auto-derive above-line from savings rules to `traditional_ira` and `401k` account subtypes (employee elective deferrals only, not employer match)
- Itemized line items: charitable cash, charitable non-cash, SALT (auto-capped at $10k), mortgage interest, other itemized
- Owner / year-range / growth-rate per row (matches incomes/expenses pattern)
- Year-by-year inflation via per-row growth rate
- New `/clients/[id]/client-data/deductions` page with read-only auto-derived summary and CRUD for itemized
- Engine integration: pass real numbers to `calculateTaxYearBracket` instead of zeros
- Default bracket mode for new clients; migrate existing flat clients to bracket via `0017` migration

**Out of scope (logged in FUTURE_WORK for v2):**
- Medical-expense deduction above 7.5% AGI threshold
- Student loan interest (capped, phase-out at higher incomes)
- 529 state deduction (varies by state)
- IRA deduction phase-out when covered by workplace plan (high-earner accuracy)
- HSA contributions from non-savings-rule sources (would need HSA account subtype)
- Alimony (pre-2019 agreements)
- Self-employment tax half deduction
- Educator expenses, sales-tax-instead-of-state-income for SALT

## Architecture

```
src/db/schema.ts                                       MODIFY
  - Add deductionTypeEnum: charitable_cash, charitable_non_cash,
    salt, mortgage_interest, other_itemized
  - Add clientDeductions table
  - Change planSettings.taxEngineMode default from 'flat' to 'bracket'

src/db/migrations/0017_client_deductions.sql          CREATE
  - CREATE TYPE deduction_type
  - CREATE TABLE client_deductions
  - ALTER plan_settings ALTER COLUMN tax_engine_mode SET DEFAULT 'bracket'
  - UPDATE plan_settings SET tax_engine_mode = 'bracket' (existing rows)

src/lib/tax/
  derive-deductions.ts                                 CREATE (~80 lines)
    - deriveAboveLineFromSavings(year, rules, accounts, isGrantor) → number
    - sumItemizedFromEntries(year, rows) → number  (applies SALT cap)
    - SALT_CAP constant ($10,000)
  __tests__/derive-deductions.test.ts                  CREATE

src/engine/types.ts                                    MODIFY
  - Add ClientDeductionRow interface
  - Extend ClientData with deductions?: ClientDeductionRow[]

src/engine/projection.ts                               MODIFY (~10 lines)
  - Per year: compute aboveLine and itemized via helpers
  - Pass to calculateTaxYearBracket call

src/app/api/clients/[id]/deductions/
  route.ts                                             CREATE (GET, POST)
  [deductionId]/route.ts                               CREATE (PUT, DELETE)
src/app/api/clients/[id]/projection-data/route.ts     MODIFY (~5 lines)

src/app/(app)/clients/[id]/client-data/deductions/
  page.tsx                                             CREATE — server component
  deductions-client.tsx                                CREATE — page-level client wrapper

src/components/forms/
  add-deduction-form.tsx                               CREATE
src/components/
  deductions-derived-summary.tsx                       CREATE — auto-derived list
  deductions-itemized-list.tsx                         CREATE — itemized list with edit/delete

src/components/client-data-sidebar.tsx                 MODIFY (+1 line)
  - Add "Deductions" link
```

**Why a polymorphic `client_deductions` table:** the line items are nearly identical in shape (owner, amount, year range, growth). Per-type tables would create 4-5 nearly-identical tables. SALT cap logic lives in the helper, not the schema.

**Why a separate `derive-deductions.ts`:** auto-derivation logic is pure and testable in isolation. Keeps `projection.ts` to a single function call.

## Schema

### New enum

```sql
CREATE TYPE "public"."deduction_type" AS ENUM(
  'charitable_cash',
  'charitable_non_cash',
  'salt',
  'mortgage_interest',
  'other_itemized'
);
```

### New table

```typescript
export const clientDeductions = pgTable("client_deductions", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),

  type: deductionTypeEnum("type").notNull(),
  name: text("name"),                                    // optional label
  owner: ownerEnum("owner").notNull().default("joint"),
  annualAmount: decimal("annual_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 }).notNull().default("0"),

  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYearRef: yearRefEnum("end_year_ref"),

  source: sourceEnum("source").notNull().default("manual"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Indexes on `(client_id, scenario_id)` for the typical query pattern.

### Default change

```sql
ALTER TABLE "plan_settings"
  ALTER COLUMN "tax_engine_mode" SET DEFAULT 'bracket';

UPDATE "plan_settings"
  SET "tax_engine_mode" = 'bracket'
  WHERE "tax_engine_mode" = 'flat';
```

Existing flat-mode advisors are flipped. They can opt back to flat via the existing toggle in the Tax Rates form. Bracket mode has been in production for a session and is well-tested.

## Engine Integration

### `derive-deductions.ts` helpers

Pure functions, no DB or React imports.

```typescript
export const SALT_CAP = 10000;

export interface SavingsRuleForDeduction {
  accountId: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
}

export interface AccountForDeduction {
  id: string;
  subType: string;
  ownerEntityId?: string | null;
}

export interface ClientDeductionRow {
  type: "charitable_cash" | "charitable_non_cash" | "salt" | "mortgage_interest" | "other_itemized";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
}

const DEDUCTIBLE_SUBTYPES = new Set(["traditional_ira", "401k"]);

export function deriveAboveLineFromSavings(
  year: number,
  savingsRules: SavingsRuleForDeduction[],
  accounts: AccountForDeduction[],
  isGrantorEntity: (entityId: string) => boolean
): number;

export function sumItemizedFromEntries(
  year: number,
  rows: ClientDeductionRow[]
): number;
```

**Auto-derive rules:**
- Only `traditional_ira` and `401k` account subtypes count (Roth variants and others excluded)
- Employee elective deferral (`annualAmount`) only — employer match is NOT deductible (it never hit the employee's W-2 income to begin with)
- Year-range filter on the savings rule
- Skip contributions to accounts owned by non-grantor entities (deduction belongs to the entity, not the household)

**Itemized sum rules:**
- Each row inflates by its `growthRate` from `startYear`
- Year-range filter per row
- SALT rows are pooled and capped at $10,000 (statutory)
- All other types are summed at full value

### `projection.ts` integration

Replace the two hardcoded zeros (around line 416-417):

```typescript
const aboveLineDeductions = deriveAboveLineFromSavings(
  year,
  data.savingsRules,
  data.accounts,
  isGrantorEntity
);
const itemizedDeductions = sumItemizedFromEntries(year, data.deductions ?? []);

// In the calculateTaxYearBracket call:
aboveLineDeductions,
itemizedDeductions,
```

### Behavioral notes

- Below-line behavior unchanged — `calculate.ts` already does `max(stdDeduction, itemizedDeductions)`
- Bracket mode opt-in still applies — flat shim ignores deductions
- Year ranges and growth match the incomes/expenses pattern
- Non-grantor entity savings excluded from above-line (the entity owes its own taxes — separate FUTURE_WORK item)

## API Layer

### New routes

```
GET    /api/clients/[id]/deductions                  → list rows for client + base scenario
POST   /api/clients/[id]/deductions                  → create row
PUT    /api/clients/[id]/deductions/[deductionId]    → update row
DELETE /api/clients/[id]/deductions/[deductionId]    → delete row
```

Auth: same Clerk-based check as other client-data routes.

### Modified route

`projection-data/route.ts` loads the deductions for the client + scenario, parses, and passes them as `data.deductions` into `runProjection`.

## UI

### Sidebar nav

`client-data-sidebar.tsx` adds a "Deductions" link between "Income & Expenses" and "Assumptions".

### Page

`/clients/[id]/client-data/deductions` shows two sections:

**Section 1 — Auto-derived from savings (read-only)**

Lists each savings rule whose account is a traditional IRA or 401k. Format:
- Account name + subtype, annual amount, year range, owner
- Footer: "Total above-line for [current year]: $X"
- Helpful link: "Edit on the Savings tab" (sidebar link to the savings page)

If no qualifying savings rules, shows an empty state: "No deductible savings rules yet. Add a Traditional IRA or 401k contribution on the Savings tab to deduct it from your taxes."

**Section 2 — Itemized deductions (CRUD)**

- "Add deduction" button (opens `add-deduction-form.tsx` modal/inline)
- List of existing rows with type, owner, amount, year range, growth rate, edit/delete buttons
- SALT rows show an inline "Capped at $10,000 (TCJA)" warning when amount > $10k
- Footer: "Total itemized for [current year]: $X" and "vs Standard deduction: $Y"; an arrow line indicating which the engine will use

**Tax inflation note** at the bottom: explains that standard deduction inflates with the tax-inflation rate, and itemized inflate per row.

### Add Deduction form (modal)

Same UX as `add-income-form.tsx` / `add-expense-form.tsx`:
- Type select (5 options)
- Name (optional text)
- Owner select (Client / Spouse / Joint)
- Annual amount
- Growth rate
- Start year + End year via `MilestoneYearPicker`
- Save / Cancel buttons

When type === `salt`, an inline note appears: "SALT is capped at $10,000 by federal law. Enter your total state + local taxes paid; the engine will apply the cap."

## Testing Strategy

### Unit tests — `derive-deductions.test.ts`

**`deriveAboveLineFromSavings`** (~10 tests):
- Sums traditional IRA contributions
- Sums 401k contributions
- Excludes Roth IRA / Roth 401k contributions
- Excludes other account types (brokerage, savings, 529)
- Year-range filter (pre-startYear and post-endYear excluded)
- Excludes non-grantor entity account contributions
- Includes grantor entity account contributions
- Multiple rules summed correctly
- Empty rules → 0
- Account not found in accounts list → skipped

**`sumItemizedFromEntries`** (~10 tests):
- Single charitable, no growth → annualAmount
- Single charitable with growth → inflated by year
- SALT under $10k → unchanged
- SALT over $10k → capped at $10k
- Multiple SALT rows summed before cap
- Mixed types: SALT capped, others uncapped
- Year-range filter
- Empty rows → 0
- "other_itemized" rows summed without cap
- Cross-row growth rates compute independently

### Engine integration — extend `projection.test.ts`

- Bracket-mode client with $24,500 401k + $7,500 IRA → `aboveLineDeductions === 32000`, AGI reduced
- Bracket-mode client with $25,000 charitable + $15,000 SALT → `belowLineDeductions === max(stdDed, 25000+10000)`
- Flat-mode regression: deductions passed but ignored, taxes match prior flat-mode value

### No React component tests

No RTL setup. Manual smoke covers UI.

### Manual smoke test

1. Migration runs cleanly; new table exists; existing `plan_settings.tax_engine_mode` rows = 'bracket'
2. Open existing client → Tax Rates form shows "Bracket-based" highlighted
3. Cashflow tax numbers match prior bracket-mode behavior (no regression)
4. New client → defaults to bracket mode
5. Sidebar shows new "Deductions" link
6. Page loads — auto-derived section shows entries (or empty state)
7. Add charitable $25k → appears in itemized; tax recomputes
8. Add SALT $20k → "Capped at $10,000" warning shown
9. Tax Detail modal → Below-Line column reflects new total
10. Edit / delete entries → updates persist and recompute
11. Flat-mode client → deductions display in UI but tax doesn't change
12. `npm test` — all existing 232 + ~20 new helper tests + new integration tests pass

### Edge cases

- Client with no savings rules → empty auto-derived state
- Mortgage interest with endYear < current year → not counted
- Spouse-owned deduction with no spouse on client → still included (advisor's responsibility)
- Migration on fresh DB with no existing plan_settings → UPDATE is a no-op, doesn't error

## Phasing for Implementation

Single phase, one plan. Expected ~9-11 tasks:
1. Migration `0017_client_deductions.sql` + Drizzle schema additions
2. Apply migration to dev DB
3. `derive-deductions.ts` + tests (TDD)
4. Wire helpers into `projection.ts` + extend `ClientData` type
5. New API routes (GET/POST + PUT/DELETE)
6. Update `projection-data/route.ts` to load and pass deductions
7. Sidebar link + new page server component
8. Auto-derived summary component + itemized list component
9. Add Deduction form (modal)
10. Engine integration tests in `projection.test.ts`
11. Manual smoke test

Estimated 1-2 sessions to execute end-to-end.

## Out-of-Scope Followups (logged separately in FUTURE_WORK after this lands)

- Medical-expense deduction above 7.5% AGI threshold
- Student loan interest (capped, phase-out)
- 529 state deduction
- IRA deduction phase-out for high earners with workplace plan
- HSA contribution support (needs HSA account subtype first)
- Per-year override schedule for deductions (paired with the broader Client Data variable-schedule work)
- React component tests for the new form / list (paired with broader RTL setup)
