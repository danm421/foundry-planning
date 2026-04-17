# Year-by-Year Schedule Overrides for Incomes, Expenses, and Savings Rules

**Date**: 2026-04-17
**Status**: Approved

## Overview

Adds a "Custom schedule" mode to income, expense, and savings rule rows. When
enabled, the advisor specifies an explicit dollar amount for each year in the
row's active range. Years without an override default to $0. The existing
growth-rate calculation is bypassed entirely — custom schedule mode means the
advisor owns every year.

A prefill calculator with three modes (Flat, Growth, Step) makes it fast to
populate the grid before hand-editing individual years.

## Schema

Three new tables with identical structure:

### income_schedule_overrides

| Column   | Type          | Notes                              |
|----------|---------------|------------------------------------|
| id       | uuid          | PK                                 |
| incomeId | uuid          | FK → incomes, cascade delete       |
| year     | integer       |                                    |
| amount   | decimal(15,2) | Override amount for that year       |

Unique constraint: `(incomeId, year)`.

### expense_schedule_overrides

Same shape. FK → expenses via `expenseId`. Unique on `(expenseId, year)`.

### savings_schedule_overrides

Same shape. FK → savings_rules via `savingsRuleId`. Unique on `(savingsRuleId, year)`.

### Mode detection

A row is in custom schedule mode when it has **any** overrides in its table.
No explicit mode flag — presence of overrides is the signal.

## Engine Changes

### income.ts — computeIncome()

Before the existing growth-rate calculation:

1. Check if the income has schedule overrides (passed in as a lookup map).
2. If yes: use the override amount for the year, or $0 if no override exists
   for that year (within the start/end range).
3. If no: existing growth-rate logic unchanged.

### expenses.ts — computeExpenses()

Identical pattern for expense computation.

### savings.ts — applySavingsRules()

If the savings rule has overrides, use the override amount instead of
`annualAmount`. Employer match still applies on top — calculated against the
override amount for that year.

### Data shape

Override data is passed into the engine as a `Map<string, Map<number, number>>`
— keyed by row ID, then by year. Built once at projection start from the DB
query.

## Dialog Structure

The existing income/expense/savings dialogs gain a second tab:

### Tab 1: Details

All existing fields. When a custom schedule exists:

- **Incomes/Expenses**: Growth rate field is **hidden**. A small inline note
  appears in its place: "Using custom schedule" (navigates to the Schedule tab
  on click).
- **Savings rules**: No growth rate field exists. The "Using custom schedule"
  note appears near the `annualAmount` field instead.

### Tab 2: Schedule

Only visible when the dialog is in edit mode (not on initial create — the row
needs a start year before a schedule makes sense).

#### Prefill calculator (top of tab)

A compact toolbar with a mode selector and inline fields:

- **Flat**: `Amount [$___]` → Apply
- **Growth**: `Start [$___] Rate [____%]` → Apply
- **Step**: `From [____] To [____] Amount [$___]` → Apply

"Apply" replaces all values in the grid (destructive — no layering).

#### Year-by-year grid

A two-column editable table:

| Year | Amount  |
|------|---------|
| 2030 | $50,000 |
| 2031 | $52,000 |
| 2032 | $0      |

- Each amount cell is an editable input.
- Empty/cleared cells default to $0.
- Row count determined by start year through end year.

### Default ranges

When the Schedule tab is first opened with no existing overrides:

- **Income**: `startYear` → client's retirement year.
- **Expense**: `startYear` → `startYear` (single year, duration = 1).
- **Savings**: `startYear` → `endYear` (matching the rule's existing range).

These defaults also set the row's `endYear` on the Details tab if it differs.

### Range changes with existing overrides

If the advisor changes `startYear` or `endYear` after overrides exist:

- **Shrink**: overrides outside the new range are deleted on save.
- **Expand**: new years within the expanded range start at $0.

### End year: duration mode

On the Details tab, the end year field gains a toggle: **Year** / **Duration**.
In duration mode the advisor types a number of years (e.g., "4") and the end
year is computed as `startYear + duration - 1`. Changing start year
recalculates end year. Applies to all three entity types.

## API Changes

### New endpoints

Each entity type gets a schedule sub-resource:

- `GET /api/clients/[id]/incomes/[incomeId]/schedule` — returns all overrides.
- `PUT /api/clients/[id]/incomes/[incomeId]/schedule` — bulk upsert: accepts
  `{ overrides: [{year, amount}, ...] }`, replaces all overrides in one
  transaction (delete + insert).
- `DELETE /api/clients/[id]/incomes/[incomeId]/schedule` — clears all
  overrides, reverting to growth-rate mode.

Same pattern for `/expenses/[expenseId]/schedule` and
`/savings-rules/[savingsRuleId]/schedule`.

### Why bulk PUT

The grid is edited as a unit and saved as a unit. Sending the full set on save
is simpler than tracking individual cell changes. Delete-and-reinsert inside a
transaction is safe at the small row counts involved (~20-40 rows per schedule).

### Changes to existing data loading

The **projection-data** API route includes schedule overrides in its response.
Three additional queries at load time, joined into the existing data shape as
optional `scheduleOverrides: {year: number, amount: number}[]` arrays on each
income/expense/savings rule object.

The income-expenses page server component adds three queries to fetch overrides
for all incomes, expenses, and savings rules. Passed to dialog components as
lookup maps.

## Testing

### Engine unit tests

For each entity type:

- A row with no overrides uses the existing growth-rate logic.
- A row with overrides uses the override amount for covered years and $0 for
  uncovered years within range.
- Savings rule overrides interact correctly with employer match (match
  calculated on override amount).

### API tests

- Bulk upsert creates/replaces overrides correctly.
- Delete clears all overrides.

### Prefill logic

Unit tests for flat, growth, and step fill functions (pure math, no UI
dependency).
