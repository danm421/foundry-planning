# Tab Rename: "Income, Expenses & Savings" → "Inflows & Outflows"

**Date:** 2026-04-19
**Branch:** `tab-rename`
**Scope:** item 3 from the 2026-04-19 improvement batch

## Goal

Shorten the client-data sidebar tab currently labeled "Income, Expenses & Savings"
to something tighter that still communicates what lives on the page.

## Decision

Rename the sidebar label to **"Inflows & Outflows"**.

Rationale: it's compact, treats savings correctly as an outflow (money leaving
the checking account), and pairs well with the other sidebar entries
("Net Worth", "Assumptions", "Deductions").

## Implementation

**Single change:** the `label` field in the sidebar nav definition at
[src/components/client-data-sidebar.tsx:90](../../src/components/client-data-sidebar.tsx#L90).

```diff
- { label: "Income, Expenses & Savings", href: "income-expenses", icon: <CashflowIcon /> },
+ { label: "Inflows & Outflows", href: "income-expenses", icon: <CashflowIcon /> },
```

## Explicitly Out of Scope

- Route path stays `/client-data/income-expenses/` (internal slug; not user-visible
  anywhere except the URL bar).
- Component name `IncomeExpensesView` and its file `src/components/income-expenses-view.tsx`
  are unchanged.
- Server route file at
  `src/app/(app)/clients/[id]/client-data/income-expenses/page.tsx` is unchanged.
- Legacy redirect at `src/app/(app)/clients/[id]/income-expenses/page.tsx`
  is unchanged.
- Per-form headings inside the view (e.g., "Add Income", "Edit Expense",
  "Add Savings Rule") stay — they describe each individual form, not the tab.

## Verification

- `npx tsc --noEmit` — no type changes expected.
- `npx vitest run` — no tests reference the old label (grep confirmed).
- Manual visual check: load a client's Details page and confirm the sidebar
  entry reads "Inflows & Outflows" and still routes to the same page.

## Risks

None. Pure string swap in one file; no behavioral change; no test fixtures
depend on the label text.
