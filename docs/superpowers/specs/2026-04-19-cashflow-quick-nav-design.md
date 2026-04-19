# Cash Flow Quick-Nav Dropdown

**Status:** Design approved 2026-04-19. Branch: `cashflow-quick-nav`.

## Problem

The Cash Flow report at `/clients/[id]/cashflow` has three parallel "top-level views" reachable only by drilling down through table rows: **Base Cash Flow** (default), **Withdrawals** (`drillPath = ["cashflow"]`), and **Assets** (`drillPath = ["portfolio"]`). A fourth detail surface — the tax breakdown — is reached by clicking a cell in the expenses row, which opens `TaxDetailModal`. Users currently can't jump between these without hunting for the right drill-down cell, and the views aren't linkable/shareable.

Add a dropdown at the top of the report that jumps directly to any of the four destinations, and URL-sync the three "view" destinations so a link like `/cashflow?view=assets` lands on that view.

## Goals

- One-click navigation between Base Cash Flow, Withdrawals, Assets, and Taxes from the report header.
- Shareable/bookmarkable URLs for the three drill views (`?view=`, `?view=withdrawals`, `?view=assets`).
- No change to the existing drill-down table UX; dropdown is additive.
- Zero new routes or layout files.

## Non-goals

- Deep-linking the tax modal (`?view=taxes` does *not* open the modal; see Deferred).
- URL persistence of sub-drill state (e.g., `["cashflow", "detail"]` — URL tracks only the top-level view).
- Converting `TaxDetailModal` into a proper drill state or route.
- Introducing shadcn or a new dropdown primitive library — we reuse a native `<select>` styled with the existing Tailwind dark theme.

## Architecture

### Components

- **New:** `src/components/cashflow/quick-nav-dropdown.tsx` — presentational, stateless. Renders a native `<select>` with four entries. Tailwind-styled to match the existing report header dark theme.
- **Modified:** [`src/components/cashflow-report.tsx`](../../../src/components/cashflow-report.tsx) — owns the URL ↔ `drillPath` bridge and renders `<QuickNavDropdown>` in its existing header row, alongside the drill breadcrumb.
- **Untouched:** [`src/app/(app)/clients/[id]/cashflow/page.tsx`](../../../src/app/(app)/clients/[id]/cashflow/page.tsx), the parent `layout.tsx`, and `TaxDetailModal`.

### Data flow

```
┌──────────────────────────┐         ┌──────────────────────┐
│  URL ?view= query param  │◀───────▶│  CashFlowReport      │
└──────────────────────────┘         │  (owns drillPath,    │
                                     │   showTaxDetailModal)│
                                     │                      │
                                     │  derives activeView  │
                                     │  from drillPath[0]   │
                                     └─────┬────────────┬───┘
                                           │ props      │ callback
                                           ▼            ▼
                                     ┌──────────────────────┐
                                     │ QuickNavDropdown     │
                                     │ (stateless control)  │
                                     └──────────────────────┘
```

### Component contract

```ts
type QuickNavView = "base" | "withdrawals" | "assets";

interface QuickNavDropdownProps {
  activeView: QuickNavView;
  onSelectView: (view: QuickNavView) => void;  // fires for base/withdrawals/assets
  onOpenTaxes: () => void;                     // fires for Taxes
}
```

- The dropdown is stateless and has no router access. All URL/state writes happen in `CashFlowReport`.
- Taxes is a one-shot action: `onOpenTaxes` calls `setShowTaxDetailModal(true)`. Taxes never shows as the "selected" option in the dropdown — it's always a click-through.

### Active-view derivation

In `CashFlowReport`, compute `activeView` from `drillPath`:

| `drillPath[0]` | `activeView` |
|---|---|
| `"cashflow"` | `"withdrawals"` |
| `"portfolio"` | `"assets"` |
| anything else (including `[]`, `"income"`, `"expenses"`, `"savings"`, `"growth"`, `"activity"`, `"other_income_detail"`) | `"base"` |

This intentionally groups all the "sub-drills of base" (Income, Expenses, Savings, etc.) under the Base active state. Those are sub-navigation *within* Base, not parallel top-level views.

### URL param contract

- Base: **no param** (clean default URL — `/cashflow`).
- Withdrawals: `?view=withdrawals`.
- Assets: `?view=assets`.
- Unknown values (including `?view=taxes` or any typo): silently treated as base. No error surfacing.
- Dropdown writes URL via `router.replace`, not `.push`. Browser Back does not accumulate a history entry per dropdown pivot.
- Only the dropdown writes the URL. Drilling within a view via existing `DrillBtn`s does not touch the URL.

### Click → state transitions

| Dropdown pick | `drillPath` after | URL after | Tax modal |
|---|---|---|---|
| Base Cash Flow | `[]` | `?view` stripped | unchanged |
| Withdrawals | `["cashflow"]` | `?view=withdrawals` | unchanged |
| Assets | `["portfolio"]` | `?view=assets` | unchanged |
| Taxes | unchanged | unchanged | opens |

Selecting any "view" entry always *replaces* the entire `drillPath`, acting as a clean escape-hatch from any deep drill.

### Initialization

On mount, `CashFlowReport` reads `?view=` once (via `useSearchParams`) and maps it to the initial `drillPath`:

- `view=withdrawals` → `["cashflow"]`
- `view=assets` → `["portfolio"]`
- anything else / missing → `[]`

No `useEffect` sync loop — URL is only ever written from the dropdown handler, so there's no risk of round-tripping.

## Placement

Inside `CashFlowReport`'s existing header area, at the top of the report, above the table, visually co-located with the drill breadcrumb trail. The dropdown moves with the component rather than the page shell.

## Testing

- **Unit (`quick-nav-dropdown.test.tsx`):**
  - Renders four options: Base Cash Flow, Withdrawals, Assets, Taxes.
  - `activeView={"withdrawals"}` renders Withdrawals as the selected option; similarly for `"assets"` and `"base"`.
  - Changing the select to Base/Withdrawals/Assets calls `onSelectView` with the matching value and does *not* call `onOpenTaxes`.
  - Changing the select to Taxes calls `onOpenTaxes` and does *not* call `onSelectView`.
- **Integration (`cashflow-report.test.tsx` or a new focused test):**
  - With mocked `useSearchParams` returning `view=withdrawals`, initial `drillPath` is `["cashflow"]`. Same for `view=assets` → `["portfolio"]`. Missing/unknown → `[]`.
  - Picking a dropdown view calls `router.replace` with the expected path (`?view=withdrawals`, `?view=assets`, or no param for Base).
- Baseline of 445 passing tests must still pass after additions.

## Accessibility

- Native `<select>` provides keyboard focus, arrow-key navigation, and screen-reader announcement for free. The element carries a visible or visually-hidden label (e.g., `aria-label="Jump to view"` or an adjacent `<label>`).
- Options have plain text labels (no icons-only).

## Deferred (goes into `docs/FUTURE_WORK.md` only if partially shipped or on request)

- Deep-link for the tax modal (`?view=taxes` auto-opens the modal on load). *Why deferred:* scope choice — Q2 in brainstorming picked "Taxes opens modal, no URL change." Revisit if users report wanting to share tax-breakdown links.
- URL persistence of sub-drill state (beyond the four top-level views). *Why deferred:* out of scope for this feature; tracking only top-level view keeps the URL contract simple.
- Converting the tax modal into a proper drill state or route. *Why deferred:* larger UX change; not required for this feature.

## Open implementation notes

- Next.js version is 16.2.3. Consult `node_modules/next/dist/docs/` for current App Router / `useSearchParams` / `useRouter` semantics before wiring the URL bridge.
- `CashFlowReport` is a client component (`"use client"`), so `useSearchParams`/`useRouter` are available directly; no server-side URL handling needed.
