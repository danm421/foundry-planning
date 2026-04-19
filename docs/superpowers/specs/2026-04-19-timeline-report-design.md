# Timeline Report — Design

Date: 2026-04-19
Branch: `timeline-report`
Worktree: `.worktrees/timeline-report`

## Goal

A client-facing "life story" report that shows the entire arc of a financial plan as an annotated timeline. One beautiful, scrollable vertical waterfall with a sparkline spine and rich event cards. Designed for on-screen use during advisor-client meetings in v1, with PDF export deferred to a later pass.

## Placement

- Route: `src/app/(app)/clients/[id]/timeline/page.tsx` — new sibling to `cashflow`, `investments`, `balance-sheet`, `balance-sheet-report`.
- Sidebar nav: new item "Timeline" alongside the other report tabs.
- Top-level component: `TimelineReportView` in `src/components/timeline-report-view.tsx`; sub-pieces under `src/components/timeline/`.

## Page layout

Top to bottom:

1. **Header bar** — report title, client name, plan span (e.g., "2026 – 2068, Ages 38 – 80").
2. **Controls row**
   - Sparkline toggle: segmented control, "Net Worth" (default) / "Portfolio" / "Net Cash Flow".
   - Category filter chips: Life · Income · Transactions · Portfolio · Insurance · Tax. Click to hide/show. Active = filled chip, inactive = outlined.
3. **Sticky mini-map** — full plan width, ~40px tall, pinned under the controls. Compressed horizontal sparkline of the selected series plus category-colored event tick marks at the bottom. A highlighted viewport window rectangle tracks what's visible below and updates on scroll via `IntersectionObserver`. Click or drag to jump.
4. **Waterfall** — the main view.
   - **Center spine** — thin vertical column with year + age(s) labeled. The selected sparkline runs inside the spine as a rotated (top-to-bottom) curve, with milestone dots in category colors.
   - **Event cards** — branch left/right off the spine via short connector lines.
     - **Couples:** primary-specific events (retirement, SS, salary) → left side; spouse-specific → right side; joint/household events (transactions, transfers, portfolio milestones, insurance proceeds) → centered on the spine.
     - **Singles:** per-person events alternate left/right down the page for rhythm; joint-level events still center on the spine.
   - **Quiet years** — years with no events render as a thin spine strip (age tick + curve only, no card space). Preserves curve continuity and pacing.
5. **Footer** — small legend: event category colors, sparkline label, click-to-expand hint.

**Responsive behavior:** below a medium breakpoint, parallel tracks collapse to a single alternating column; mini-map shrinks to just the curve without tick marks.

## Event card

### Collapsed (default)
- Small colored category pill (Life / Income / Transaction / Portfolio / Insurance / Tax) — the card's color identity.
- Bold title — "Retirement", "Home sale", "SS begins".
- Subject label when relevant — "Dan", "Jane", or omitted for joint events.
- One supporting figure — e.g., "$180,000 salary ends", "$1.2M sale · $950K net", "Portfolio crosses $2M".
- Year + age chip, small, attached to the connector line.

### Expanded (click)
- Full descriptive context for that event. Examples:
  - Home sale: sale price, mortgage paid off, §121 exclusion applied, net proceeds, destination account.
  - Retirement: salary ending, remaining income streams that continue, tax-bracket shift this year (if notable).
- Relevant sub-figures: tax impact, cash-flow impact this year, account deltas.
- One or two "Open in…" links jumping to existing routes with the relevant year pre-selected (e.g., Cash Flow year, transaction detail, tax year). No new drill-down pages are built for v1.
- Expanded state persists until re-clicked. Only one card expanded at a time.

### Visual language
- Category hue on the pill; card body stays neutral. Accessible contrast on both.
- Subject labels (primary/spouse) are visually lighter than the category pill — secondary identity.
- Expanded cards grow downward with a short height animation.

### Hover
- Slight elevation shift. Connector line to spine brightens. Matching dot on the spine sparkline highlights in the card's category color.

## Event taxonomy

All events are derived at render time from `ProjectionYear[]` + `ClientData`. No engine changes.

### Categories and detector responsibilities

- **Life** — retirement, death, Social Security claim age, Medicare eligibility (65), SS Full Retirement Age (67). Sourced from `ClientInfo.dateOfBirth` + `EntitySummary` retirement/life-expectancy fields + per-entity SS claim year.
- **Income** — salary start/stop (from `Income.startYear / endYear` per entity), pension start, SS begins (income of type social security).
- **Transaction** — every `AssetTransaction` firing emits an event; `ProjectionYear.techniqueBreakdown` (sales/purchases) supplies runtime figures (sale value, net proceeds, mortgage paid off, capital gain). Transfers (`Transfer` → `TransferSchedule`) emit their first occurrence and any material one-off amounts; recurring small transfers are suppressed in v1.
- **Portfolio** — first-withdrawal year per account (detected via `withdrawals.byAccount` going non-zero for the first time); RMDs begin (first year `rmdAmount > 0` on any account); user-configurable threshold crossings (v1 defaults: `$1M`, `$2M`, `$5M`, `$10M`) fire exactly once at the crossing year; portfolio peak year. Both threshold crossings and peak detection run against the **investable** portfolio series (taxable + cash + retirement totals), matching the "Portfolio" sparkline definition — not `portfolioAssets.total`.
- **Insurance** — life-insurance proceeds paid (detected from projection outputs where death triggers proceed flows).
- **Tax** — Roth conversions (if present), first year in a new federal ordinary bracket (from `taxResult`), first negative-cash-flow year (one-time). IRMAA detection is deferred.

### Dedupe and priority

When multiple detectors emit an event for the same underlying moment (e.g., "SS claim" as Life and "SS begins" as Income), a fixed priority array in the orchestrator picks one and drops the others. Tests cover each known collision.

### Event type

```ts
type TimelineCategory = "life" | "income" | "transaction" | "portfolio" | "insurance" | "tax";
type TimelineSubject = "primary" | "spouse" | "joint";

interface TimelineEventDetail {
  label: string;
  value: string; // pre-formatted (currency/percent/text)
}

interface TimelineEventLink {
  label: string;
  href: string;
}

interface TimelineEvent {
  id: string;                       // stable, e.g. `life:retire:primary:2044`
  year: number;
  age?: number;                     // subject age where applicable
  category: TimelineCategory;
  subject: TimelineSubject;
  title: string;
  supportingFigure?: string;        // collapsed one-liner
  details: TimelineEventDetail[];   // expanded key/value rows
  links?: TimelineEventLink[];
}
```

## Sparkline & mini-map

### Series
All three series are derived once per render into `SeriesPoint[]`:

```ts
interface SeriesPoint {
  year: number;
  netWorth: number;     // portfolioAssets.total − total liability balances at end of year
  portfolio: number;    // taxableTotal + cashTotal + retirementTotal (investable assets only)
  netCashFlow: number;  // ProjectionYear.netCashFlow
}
```

`portfolioAssets.total` in the engine already sums taxable + cash + retirement + realEstate + business + lifeInsurance, so `netWorth` = gross assets − liabilities. "Portfolio" in this report means investable assets only (excludes real estate / business / life insurance) because that's what clients mean when they say "my portfolio hit $1M". End-of-year liability balance is derived during implementation from `liabilityBalancesBoY` + the year's amortization; exact field choice is a small implementation detail.

### Rendering
- Lightweight SVG path generated from normalized series data. No charting library dependency; same approach the app uses elsewhere (cf. `drift-chart.tsx`).
- Spine sparkline is rotated 90° (top-to-bottom). Amplitude normalized across the visible span; axis gridlines suppressed.
- Milestone dots on the curve are small filled circles colored by category.
- Negative net-cash-flow sections render below an implicit zero line in a secondary hue.

### Mini-map
- `position: sticky`, below the controls row, full page width.
- Same selected series, horizontal.
- Event tick marks along the bottom, one per event, colored by category, deduped per year when many events share a year.
- Viewport window rectangle overlays the mini-map, tracking the year range currently visible in the waterfall. Scroll sync via `IntersectionObserver` attached to each year spine segment.
- Click → smooth scroll the waterfall to the corresponding year with a brief landing highlight (~800ms). Drag → continuous scroll while active.

## Interactions

- **Card expand/collapse:** click a collapsed card expands it in place with a short height animation; only one card expanded at a time; Escape or outside-click collapses; Tab + Enter/Space keyboard control.
- **Category filter chips:** toggling a chip fades + removes matching cards and updates mini-map tick marks. The sparkline itself is unaffected; filtered-out event dots on the curve dim but remain, so the curve shape never changes.
- **Sparkline toggle:** recomputes normalized series and re-renders spine + mini-map together with a short crossfade (~150–200ms).
- **Mini-map navigation:** click or drag to navigate; target year briefly highlights on arrival.
- **Sparkline ↔ card hover link:** hovering an event card highlights its corresponding spine dot. (The reverse — hovering a dot to highlight a card — is deferred to a later polish pass.)
- **Drill-down links:** "Open in Cash Flow" and similar navigate to existing routes with a year pre-selected via URL param; no new pages are built in v1.
- **Keyboard:** Tab moves between cards in year order; Enter/Space expands/collapses a focused card; Escape collapses the active card; Arrow-up / Arrow-down jumps to the previous/next card.

## Component & file layout

```
src/
  app/(app)/clients/[id]/timeline/
    page.tsx                          # loads plan + projection, renders TimelineReport
  components/
    timeline-report-view.tsx          # top-level; owns filter + sparkline toggle state
    timeline/
      timeline-controls.tsx           # sparkline toggle + category chips
      timeline-minimap.tsx            # sticky horizontal strip + viewport window
      timeline-spine.tsx              # year/age column + rotated sparkline
      timeline-year-segment.tsx       # one year's spine segment + left/right cards
      timeline-event-card.tsx         # collapsed + expanded states, category pill
      timeline-sparkline.tsx          # shared SVG curve renderer (spine + minimap)
      timeline-category-pill.tsx      # small reusable pill
  lib/timeline/
    build-timeline.ts                 # ProjectionYear[] + ClientData → TimelineEvent[]
    build-series.ts                   # ProjectionYear[] → SeriesPoint[]
    timeline-types.ts                 # shared types
    detectors/
      life.ts
      income.ts
      transactions.ts
      portfolio.ts
      insurance.ts
      tax.ts
    __tests__/
      build-timeline.test.ts
      build-series.test.ts
      detectors/life.test.ts
      detectors/income.test.ts
      detectors/transactions.test.ts
      detectors/portfolio.test.ts
      detectors/insurance.test.ts
      detectors/tax.test.ts
```

### Why this shape

- **Detectors are one-per-category**, each under ~150 lines, independently testable. Mirrors the existing engine split (`income.ts`, `expenses.ts`, `tax.ts` as siblings).
- **`build-timeline.ts` orchestrates** — calls each detector, dedupes via priority array, sorts by `(year asc, category priority, subject)`, returns the final array.
- **`build-series.ts` is independent** of `build-timeline.ts` — the sparkline does not depend on events existing.
- **UI components stay small and focused.** Top-level `TimelineReportView` orchestrates state; each subcomponent has a single visual responsibility.
- **No new engine code. No schema or DB changes.**

### Data flow

1. `page.tsx` (server component) fetches plan + `ClientData`, runs the existing projection, passes both to `TimelineReportView` as props.
2. `TimelineReportView` derives events and series in `useMemo`:
   ```ts
   const events = useMemo(() => buildTimeline(projection, clientData), [projection, clientData]);
   const series = useMemo(() => buildSeries(projection), [projection]);
   ```
3. Local state owned by `TimelineReportView`:
   - currently-visible year range (from `IntersectionObserver`),
   - active sparkline mode,
   - active category filters,
   - expanded event id (single).
4. Subcomponents receive already-derived data as props. No internal data fetching; no duplicated derivation.

## Testing

### Detectors (`src/lib/timeline/detectors/__tests__/`)

Each detector has its own test file using fixtures from `src/engine/__tests__/fixtures.ts`.

- **life.ts** — retirement age fires in correct year for primary and spouse; death age fires; Medicare 65 and SS FRA 67 fire at correct ages; single-person plan produces only primary events.
- **income.ts** — salary start/stop emits exactly one event per job transition; pension start; SS begins when income type is social security.
- **transactions.ts** — each `AssetTransaction` produces an event with the correct supporting figure sourced from `techniqueBreakdown`; transfer first-occurrence detection; recurring transfer suppression.
- **portfolio.ts** — first-withdrawal year detected from `withdrawals.byAccount`; RMD start from `rmdAmount`; threshold crossings fire exactly once at the crossing year (not every year above); portfolio peak picks the correct year.
- **insurance.ts** — life-insurance proceeds event fires in the death year for the surviving entity.
- **tax.ts** — Roth conversion detection; first federal-bracket change detection; first negative-cash-flow year fires only once.

### Orchestrator (`build-timeline.test.ts`)

- Dedupe priority: SS claim appears as Life, not Income, when both fire.
- Deterministic sort: given fixed input, output is stable by `(year asc, category priority, subject)`.
- Edge cases: plan with no transactions, no spouse, no death (life expectancy past projection end), single-year plan.
- Event `id` stability: same input produces same ids across runs.

### Series (`build-series.test.ts`)

- `netWorth[y]` = portfolio total + non-portfolio real assets − liabilities, per year.
- `portfolio[y]` = `portfolioAssets.total`.
- `netCashFlow[y]` = `netCashFlow`.
- Zero-projection plan returns an empty array.

### Component smoke tests (`src/components/timeline/__tests__/`)

- `TimelineReportView` renders without throwing given a realistic fixture.
- Category chip toggle removes/restores matching cards.
- Sparkline mode toggle re-renders curves with correct keyed data.
- Clicking an event card expands it; clicking again collapses.
- Keyboard: Tab reaches cards in order; Enter/Space toggles; Escape collapses.

### Coverage target

- Detector modules, `build-timeline`, `build-series`: ~100% branch coverage (pure functions).
- Components: smoke-level coverage only.

### Not in v1

No integration/e2e tests — existing reports don't have them; matching convention keeps v1 shippable.

## Out of scope for v1 (deferred)

Tracked in `docs/FUTURE_WORK.md` once the feature ships:

- **PDF export.** Semantic HTML + `page-break-inside: avoid` on cards + a print hook that hides the sticky mini-map during implementation means the follow-up is styling + wiring, not rewriting.
- **User-configurable portfolio milestone thresholds.** v1 ships baked-in defaults (`$1M`, `$2M`, `$5M`, `$10M`); settings UI is a follow-up.
- **Year-range slider.** Deferred; mini-map + filters cover the 80% case.
- **URL state persistence** (filters, active sparkline, expanded card). v1 keeps state component-local.
- **IRMAA-triggering year detection.** Requires a tax-data signal we may not surface today.
- **Transfer "bands" for recurring small transfers.** v1 suppresses them.
- **Animation polish pass.** v1 ships functional animations only.
- **Hover dot → highlight card** on the sparkline (reverse direction). v1 ships card → dot only.

## Success criteria

- Given a typical plan (couple, 40-year horizon, multiple transactions, retirement + death modeled), the timeline renders all expected event categories, the sparkline reflects the selected series, and the mini-map + waterfall scroll in sync.
- All detector and series tests pass with ~100% branch coverage on the pure-function modules.
- Component smoke tests pass.
- No regressions in the existing engine/test suite (baseline 516/516 passing in this worktree).
- Manual QA confirms the report is legible on typical laptop viewports and collapses cleanly on a medium-small viewport.
