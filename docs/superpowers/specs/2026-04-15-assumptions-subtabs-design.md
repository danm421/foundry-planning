# Assumptions Page Subtabs — Design Spec

## Overview

Reorganize the assumptions page from a single scrollable form into 4 focused
subtabs with a horizontal tab bar. Each tab renders its own section with its own
Save button. Prepares the page for future additions (bracket-based tax engine,
CMAs, Roth optimizer, entity withdrawals) without the page becoming unwieldy.

## Subtab Structure

```
[ Plan Horizon ]  [ Tax Rates ]  [ Growth & Inflation ]  [ Withdrawal Strategy ]
```

### Plan Horizon (default active tab)
- Plan start year (integer, 2000–2100)
- Plan end year (integer, 2000–2100)

### Tax Rates
- Federal tax rate (0–50%, stored as decimal)
- State tax rate (0–20%, stored as decimal)

### Growth & Inflation
- Inflation rate (0–20%, stored as decimal)
- 6 default growth rates by account category:
  - Taxable (brokerage, trust, other)
  - Cash (savings, checking, money-market)
  - Retirement (IRA, 401k, Roth, 529)
  - Real Estate (residences, property)
  - Business (ownership interests, entities)
  - Life Insurance (cash-value policies)

### Withdrawal Strategy
- Priority-ordered account list (existing WithdrawalStrategySection component)
- Add/remove accounts, drag-to-reorder

## Architecture

### Files Changed

```
src/
  app/(app)/clients/[id]/client-data/assumptions/
    page.tsx                          # MODIFY: pass data to new client component
    assumptions-client.tsx            # CREATE: client component with tab state
  components/
    forms/
      assumptions-form.tsx            # MODIFY: split into 3 sub-forms
      plan-horizon-form.tsx           # CREATE: start/end year fields + save
      tax-rates-form.tsx              # CREATE: federal/state rate fields + save
      growth-inflation-form.tsx       # CREATE: inflation + 6 growth rates + save
    assumptions-subtabs.tsx           # CREATE: horizontal tab bar component
```

### Tab Bar Component

New `AssumptionsSubtabs` component renders a horizontal row of tab buttons.
Props: `tabs: { id, label }[]`, `activeTab: string`, `onTabChange: (id) => void`.

Styling matches existing sidebar tab pattern:
- Active: `bg-gray-800 text-gray-100`
- Inactive: `text-gray-400 hover:bg-gray-800/50 hover:text-gray-200`
- Horizontal layout with `flex gap-1` and `rounded-md px-3 py-1.5 text-sm font-medium`

### Page Structure

The server component (`page.tsx`) fetches all data (client, scenario, plan
settings, accounts, withdrawal strategies) as it does today and passes
everything to a new client component (`assumptions-client.tsx`).

The client component owns the `activeTab` state and conditionally renders:
- `"plan-horizon"` → `<PlanHorizonForm />`
- `"tax-rates"` → `<TaxRatesForm />`
- `"growth-inflation"` → `<GrowthInflationForm />`
- `"withdrawal"` → `<WithdrawalStrategySection />`

### Sub-Form Components

Each sub-form:
- Receives the relevant plan settings fields as props
- Has its own local form state
- PUTs to `/api/clients/[id]/plan-settings` on save (same endpoint as today)
- Shows its own "Save" button with loading state
- Only sends the fields it owns (partial update)

The existing `AssumptionsForm` is replaced by these three focused forms. The
old file can be deleted or kept as a re-export for backwards compatibility.

### Data Flow

No schema or API changes needed. The existing `PUT /api/clients/[id]/plan-settings`
endpoint already accepts partial updates — each sub-form sends only its fields.

## Styling

- Tab bar sits at the top of the content area, below the page heading
- Bottom border under the tab bar: `border-b border-gray-800`
- Active tab content renders below with `mt-6` spacing
- Each sub-form uses the same input/label/button classes as the existing form
- Growth & Inflation tab preserves the accordion-style list for the 6 growth rates
