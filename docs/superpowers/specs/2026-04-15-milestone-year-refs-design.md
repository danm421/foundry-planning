# Milestone Year References + Smart Defaults — Design Spec

## Overview

Replace hardcoded year integers with optional milestone references that
auto-resolve to the correct year based on client data. When a referenced
milestone changes (e.g., retirement age), all linked dates update on next load.

Also adds smart defaults: when adding a salary, start/end years auto-fill to
plan start / retirement. Social Security gets claiming age presets (62, FRA, 70).

## Milestones

```typescript
type YearRef =
  | "plan_start"
  | "plan_end"
  | "client_retirement"
  | "spouse_retirement"
  | "client_end"        // DOB + planEndAge
  | "spouse_end"        // spouse DOB + planEndAge
  | "client_ss_62"
  | "client_ss_fra"
  | "client_ss_70"
  | "spouse_ss_62"
  | "spouse_ss_fra"
  | "spouse_ss_70";
```

## Schema Changes

Add `startYearRef` and `endYearRef` nullable enum columns to these tables:
- `incomes`
- `expenses`
- `liabilities`
- `savingsRules`
- `withdrawalStrategies`

The existing `startYear` / `endYear` integer columns are unchanged and always
hold the resolved numeric value (engine reads these directly).

### Migration

One migration adding the `year_ref` enum type and 10 new nullable columns
(2 per table). No data migration — existing rows get null refs (manual dates).

## Milestone Resolution

### Resolver function

`resolveMilestone(ref: YearRef, clientData: ClientMilestones): number`

ClientMilestones computed once per page load from:
- `client.dateOfBirth` + `client.retirementAge` → clientRetirementYear
- `client.dateOfBirth` + `client.planEndAge` → clientEndYear
- `client.spouseDob` + `client.spouseRetirementAge` → spouseRetirementYear
- `client.spouseDob` + `client.planEndAge` → spouseEndYear
- `planSettings.planStartYear` → planStart
- `planSettings.planEndYear` → planEnd
- SS ages: DOB + 62, DOB + FRA (67 default), DOB + 70

### Resolution on read

Server page components that load incomes/expenses/liabilities/savings/withdrawal
check each row. If `startYearRef` or `endYearRef` is set, recompute the resolved
year. If it differs from the stored value, batch-update the stale rows. This is
a silent fixup — the user sees the correct year without any action.

Implemented as a shared utility: `resolveAndUpdateYearRefs(rows, clientMilestones, tableName, db)`

## Smart Defaults

When creating a new record, the API and UI pre-fill start/end years AND refs:

| Record Type | Owner | Default startYearRef | Default endYearRef |
|---|---|---|---|
| salary | client | plan_start | client_retirement |
| salary | spouse | plan_start | spouse_retirement |
| social_security | client | (from claimingAge) | client_end |
| social_security | spouse | (from claimingAge) | spouse_end |
| business | client | plan_start | client_retirement |
| business | spouse | plan_start | spouse_retirement |
| deferred | client | client_retirement | client_end |
| deferred | spouse | spouse_retirement | spouse_end |
| capital_gains | * | plan_start | plan_end |
| trust | * | plan_start | plan_end |
| other income | * | plan_start | plan_end |
| living expense | * | plan_start | plan_end |
| insurance expense | * | plan_start | plan_end |
| other expense | * | plan_start | plan_end |
| liability | * | plan_start | null (manual) |
| savings rule | * | plan_start | client_retirement |
| withdrawal | * | client_retirement | plan_end |

For Social Security, the start year is DOB + claimingAge (no ref). The claiming
age picker offers preset buttons: 62, FRA, 67, 70, Ret.

## UI: MilestoneYearPicker Component

Replaces the raw number input + YearQuickFill buttons everywhere year fields
appear. The component shows:

1. A select dropdown with milestone options, each showing the resolved year:
   ```
   ┌──────────────────────────────┐
   │ Manual                       │
   │ Plan Start (2026)            │
   │ Plan End (2060)              │
   │ Client Retirement (2027)     │
   │ Spouse Retirement (2030)     │
   │ Client End of Plan (2060)    │
   │ Spouse End of Plan (2063)    │
   └──────────────────────────────┘
   ```
   SS milestones only shown when the income type is social_security.

2. When a milestone is selected: the year input auto-fills with the resolved
   year and becomes read-only. A small badge appears showing the milestone name.

3. When "Manual" is selected: the year input is editable as a normal number field.

4. The component emits both `year: number` and `yearRef: YearRef | null`.

## Files Changed

```
src/db/schema.ts                          # Add yearRef enum + columns
src/db/migrations/NNNN_add_year_refs.sql  # Migration SQL
src/lib/milestones.ts                     # Resolver, defaults, types
src/components/milestone-year-picker.tsx   # New picker component
src/components/income-expenses-view.tsx    # Replace YearQuickFill with picker
src/components/forms/add-liability-form.tsx # Add picker
src/components/withdrawal-strategy-section.tsx # Add picker
src/app/api/clients/[id]/incomes/route.ts     # Accept refs, apply defaults
src/app/api/clients/[id]/expenses/route.ts    # Accept refs, apply defaults
src/app/api/clients/[id]/liabilities/route.ts # Accept refs
src/app/api/clients/[id]/savings-rules/route.ts # Accept refs
src/app/api/clients/[id]/withdrawal-strategy/route.ts # Accept refs
src/app/(app)/clients/[id]/client-data/income-expenses/page.tsx # Resolve on load
src/app/(app)/clients/[id]/client-data/assumptions/page.tsx     # Resolve on load
```
