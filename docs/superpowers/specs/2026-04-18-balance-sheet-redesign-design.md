# Balance Sheet Report Redesign

- **Date:** 2026-04-18
- **Branch:** `balance-sheet`
- **Status:** Design — ready for planning

## Motivation

The current balance sheet report at `/clients/[id]/balance-sheet-report` is a flat list of asset categories. It has no liabilities section (despite the engine tracking them), no charts, no ownership breakdown, no YoY context, and no export path. An advisor looking at this page cannot tell at a glance how the client's balance sheet is composed, how it has changed, or who owns what. This redesign turns it into a report an advisor would actually bring into a client meeting.

## Scope

### In scope (this spec — Phase 1)

- Full rewrite of `balance-sheet-report-view.tsx` into a three-panel layout (Assets / Center visualizations / Liabilities).
- New Liabilities panel (currently missing entirely).
- Allocation donut chart and 5-year Assets-vs-Liabilities bar chart (chart.js).
- Year-over-year (YoY) % badges on totals, computed against the prior projection year.
- Ownership view selector: `Consolidated` / `Client only` / `Spouse only` / `Joint only` / `Entities only`. Hidden for single filers; `Entities only` only appears when the client has entity-owned accounts.
- Real Estate Equity KPI (market value − linked mortgage balances).
- Mortgage indicator badge on real estate asset rows that have a linked liability.
- `AS OF` year-only selector covering the projection window.
- "Export PDF" button producing a light-themed PDF via `@react-pdf/renderer`.

### Explicitly deferred (future spec — Phase 2)

- **Account history feature.** Adds `account_history` / `liability_history` tables and a history tab under Client Data → Balance Sheet. Capture triggers: on edit, on `as_of_date` bump, and via manual entry for backfill. Once shipped, the report's past-year data source swaps from projection to history where history exists.

### Explicitly out of scope

- Top nav / global app shell changes (the mockup's chrome was illustrative only).
- Sparklines on individual rows.
- Liquidity view, debt-to-asset ratio KPI, estate vs non-estate split as a dedicated section. (Entity-owned accounts still get visually separated inside the Consolidated view.)
- Year-over-year source other than the prior projection year.

## Design decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope of redesign | Content area only; keep foundry-planning's existing nav/shell |
| 2 | Sparklines | None |
| 3 | Data views | Assets by category + drill-down, Liabilities panel, Net Worth card, allocation donut, YoY bar chart, YoY % badges, ownership breakdown, Real Estate Equity KPI, year selector |
| 4 | Account history | Deferred to Phase 2; all capture modes (edit / as-of bump / manual backfill) |
| 5 | Ownership integration | Dropdown view selector in header; entity-owned accounts visually separated in Consolidated and available as their own filter |
| 6a | AS OF granularity | Year-only, covering projection range |
| 6b | Bar chart window | 5-year rolling (2 back / selected / 2 forward), clamped to projection bounds |
| 7 | PDF approach | `@react-pdf/renderer` parallel component tree |
| 8 | Real estate display | Market value on row + mortgage indicator badge + separate Real Estate Equity KPI |
| 9 | PDF theme | Light — screen stays dark; shared design tokens prevent drift |

## Architecture

### File layout

```
src/components/
  balance-sheet-report-view.tsx            ← rewrite
  balance-sheet-report/
    assets-panel.tsx                       ← new
    liabilities-panel.tsx                  ← new
    center-column.tsx                      ← new
    header-controls.tsx                    ← new
    ownership-filter.ts                    ← new (pure, unit tested)
    yoy.ts                                 ← new (pure, unit tested)
    view-model.ts                          ← new (projection → report view model)
    tokens.ts                              ← new (colors, sizes — shared w/ PDF)
  balance-sheet-report-pdf/
    balance-sheet-pdf-document.tsx         ← new — @react-pdf/renderer tree
    chart-to-image.ts                      ← new — canvas → PNG helper

src/app/(app)/clients/[id]/balance-sheet-report/
  page.tsx                                 ← unchanged
  export-pdf/route.ts                      ← new — API route producing PDF blob
```

### Data flow

1. `page.tsx` (server component) loads the client and derives `ownershipContext` (filing status, spouse name, list of entities).
2. `BalanceSheetReportView` (client) fetches `/api/clients/[id]/projection-data`, runs `runProjection()`, and memoizes the result.
3. `view-model.ts` converts a `ProjectionYear` + ownership filter into a `BalanceSheetViewModel`: categorized asset rows, liability rows, totals, YoY deltas, donut slices, bar chart series. One function, pure, unit-tested.
4. Panels receive slices of the view model. They are presentational — no fetching.
5. Export flow: user clicks Export → browser captures `donut` and `barChart` canvases as PNG data URLs → POSTs `{ year, view, donutPng, barChartPng }` to `export-pdf/route.ts` → handler rebuilds the view model server-side and streams a PDF blob back.

### Ownership filtering

`ownership-filter.ts` exports one pure function:

```ts
filterByView(rows: Row[], view: OwnershipView, entityIds: string[]): Row[]
```

`OwnershipView` is `"consolidated" | "client" | "spouse" | "joint" | "entities"`. Entity-owned rows are detected via `ownerEntityId != null`.

**View semantics (definitive):**

| View | Asset rows included | Liability rows included | Counted in Total Assets / Total Liabilities / Net Worth / donut / bar chart? |
|------|---------------------|-------------------------|---|
| `consolidated` | All personal (`client` + `spouse` + `joint`, no entity) in their categories, **plus** a separate "Out of Estate" group for entity-owned | All | Yes — everything (personal + entity-owned) is included in the totals, donut, and bar chart. The "Out of Estate" group is a visual grouping in the Assets panel only. |
| `client` | `owner === "client" && ownerEntityId == null` | same predicate | Yes, scoped to that owner |
| `spouse` | `owner === "spouse" && ownerEntityId == null` | same predicate | Yes, scoped to that owner |
| `joint` | `owner === "joint" && ownerEntityId == null` | same predicate | Yes, scoped to that owner |
| `entities` | `ownerEntityId != null` | `ownerEntityId != null` | Yes, scoped to entity-owned only |

Entity-owned rows never leak into `client` / `spouse` / `joint` filters, even when the underlying `owner` column names one of them. The ownership view is a display filter only; it does not change the underlying projection engine inputs.

### YoY

`yoy.ts` exports pure helpers:

```ts
yoyPct(current: number, prior: number): { value: number; badge: "up" | "down" | "flat" } | null
sliceBarWindow(years: ProjectionYear[], selectedYear: number): YearDatum[]
```

YoY is `null` for the first projection year (no prior to compare against). Bar window clamps to available years — if only 3 years are projected, the chart shows 3 years, not 5.

## Page layout

Desktop (≥ 1024px): CSS grid, columns `[1fr, 1.1fr, 1fr]`. Below 1024px: single column stack.

```
┌────────────────────────────────────────────────────────────────┐
│  Balance Sheet · [AS OF ▼] · [View ▼] · [Export PDF]           │
├───────────────┬────────────────────────┬───────────────────────┤
│   ASSETS      │  TOTAL ASSETS (KPI)    │   LIABILITIES         │
│   panel       │  Allocation donut      │   panel               │
│               │  5-yr A-vs-L bar chart │                       │
│               │  Real Estate Equity    │                       │
│               │  NET WORTH (KPI)       │                       │
└───────────────┴────────────────────────┴───────────────────────┘
```

## Panels

### Assets panel (left)

- Categories render in order: Cash, Taxable, Retirement, Real Estate, Business, Life Insurance. Zero-total categories hide.
- Each category card: header (name · total · YoY badge) + account rows.
- Each row: account name · owner chip · balance.
- Real estate row with a linked liability shows a small "M" chip with tooltip `Has linked mortgage — see Liabilities`.
- Entity-owned accounts render as a final "Entities / Out of Estate" group in Consolidated view; in `Entities only` view they are the only rows.
- View filter narrows rows and recomputes category totals and YoY. Empty categories hide.

### Liabilities panel (right)

- Flat list, no categories.
- Panel header: "Total Liabilities" + total + YoY badge.
- Each row: liability name · owner chip · BoY balance (from `yearData.liabilityBalancesBoY`).
- Empty state: "No liabilities."

### Center column (top to bottom)

1. **Total Assets KPI card** — large value + YoY badge.
2. **Allocation donut** — one slice per non-zero asset category, labeled with % of filtered total.
3. **5-year Assets-vs-Liabilities bar chart** — grouped bars, two series (assets, liabilities), 2 back / selected / 2 forward, clamped.
4. **Real Estate Equity KPI card** — hides when client has no real estate.
5. **Net Worth KPI card** — filtered Assets − filtered Liabilities + YoY badge. Gets accent treatment (subtle glow / gradient).

## Header controls

- **AS OF selector** — `<select>` of projection years; defaults to year 0.
- **View selector** — dropdown with the five options. Hidden for single filers. `Entities only` option hidden when no entity-owned accounts exist.
- **Export PDF button** — triggers the PDF pipeline. Disabled with a spinner while rendering.

## Visual treatment

- Base: existing Tailwind dark-theme panel style (`bg-gray-900 border-gray-800 rounded-lg`).
- Polish: subtle gradient wash on each panel header, color-coded category icons matching donut slice colors, glow/accent on Net Worth card.
- Not a pixel-match to the mockup — aligned with foundry-planning's existing dark theme.

### Color tokens (`tokens.ts`)

Shared between screen and PDF views so the two can't drift. Each theme (`screen`, `pdf`) exports:

```
categoryColors: { cash, taxable, retirement, realEstate, business, lifeInsurance }
status: { up, down, flat }
surface: { bg, panel, panelHeader, divider }
text: { primary, secondary, muted }
```

Screen uses dark palette. PDF uses light palette.

## PDF export

- **Trigger:** `GET /api/clients/[id]/balance-sheet-report/export-pdf?year=Y&view=V` streaming a PDF blob. Filename: `balance-sheet-{clientLastName}-{year}.pdf`.
- **Chart images:** captured client-side from the already-rendered canvases via `toDataURL("image/png")`, posted with the request body.
- **Document:** React tree using `@react-pdf/renderer` primitives (`Document`, `Page`, `View`, `Text`, `Image`). Single portrait page; overflow auto-paginates.
- **Theme:** light palette from `tokens.ts` — print-friendly while still intentional. Ink-efficient.
- **Header strip:** client name, "Balance Sheet", `AS OF` year, view, generated-on timestamp.
- **Footer:** page number.
- **Layout:** same three-panel structure as screen, rebuilt with flex (no CSS grid in react-pdf).

## Edge cases

- Single filer → View selector hidden, owner chips hidden everywhere.
- Zero liabilities → "No liabilities" empty state; Net Worth still computes.
- No entity-owned accounts → `Entities only` option hidden; no "Out of Estate" group renders.
- Projection shorter than 5 years → bar chart clamps.
- Selected year has no prior (year 0) → YoY badges render as `—` or hide.
- No real estate → Real Estate Equity KPI hides.

## Testing

- `ownership-filter.ts` — unit tests for each view, including entity handling and single-filer.
- `yoy.ts` — unit tests for normal YoY, year-0 null case, bar-window clamping at both ends.
- `view-model.ts` — unit tests for mapping a `ProjectionYear` + filter to the expected shape, covering: all asset categories populated, mixed owners, real-estate-with-mortgage equity, all edge cases above.
- No integration tests on the React tree beyond a smoke render; the heavy lifting is in pure functions.
- PDF: manual verification plus a snapshot test on the `BalanceSheetPdfDocument` component's React tree output.

## Dependencies

Adds `@react-pdf/renderer`. Everything else (`chart.js`, `react-chartjs-2`) is already installed.

## Open questions

None — all resolved during brainstorming.
