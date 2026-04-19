# Monte Carlo v2 — Report UI Redesign

Date: 2026-04-19
Branch: `monte-carlo-planning`
Worktree: `.worktrees/monte-carlo-planning`

## Goal

Rebuild the Monte Carlo report page into a polished, client-facing artifact that communicates plan durability at a glance. The v1 report shipped the engine and a minimal 4-KPI + table shell; v2 turns it into the face of the feature: hero gauge, fan chart, right-rail insights, and a repurposed bottom slot for a terminal-value distribution. Engine and API layers are not touched. This is a pure visual-and-composition rebuild of `src/components/monte-carlo-report.tsx`.

## Placement

- Route: `src/app/(app)/clients/[id]/monte-carlo/page.tsx` — unchanged server wrapper, already in place.
- Top-level component: `MonteCarloReport` in `src/components/monte-carlo-report.tsx` — kept as the orchestrator (data fetching, engine run, seed/progress state, cross-client reset), but its body is rebuilt by composing new subcomponents.
- Sub-pieces: new directory `src/components/monte-carlo/` housing focused presentational components and pure helpers.

## Non-goals

Out of scope for v2 and tracked in `docs/FUTURE_WORK.md`:

- Interactive Variables / what-if panel.
- "View Scenario" CTA behavior (button renders visible-but-disabled with `title="Coming soon"`).
- AI-generated recommendations text (card reserves the slot with an empty state).
- Real Top Risks attribution engine (v2 uses three static heuristics).
- Web Worker execution, correlation admin UI, per-plan required-minimum-asset-level column, inflation randomization.

## Design system anchors

The app is dark-themed by default (`--background: #030712`, `--foreground: #f3f4f6`), Tailwind v4, no shadcn. Charting is chart.js + react-chartjs-2 (already registered in `src/components/cashflow-report.tsx` with a `timelineMarkersPlugin` pattern we reuse).

Timeline's recent "jewel accents" refresh established the visual language used throughout the right rail and KPI band:

- Card surface: `bg-slate-900/60 ring-1 ring-slate-800`, rounded, subtle shadow.
- Positive / success signals: emerald — `bg-emerald-400/10 text-emerald-300 ring-emerald-400/40 shadow-[0_0_12px_rgba(52,211,153,0.15)]`.
- Downside / caution: rose — same pattern with rose-400.
- Neutral / secondary: slate-400 copy on slate-900 surfaces.
- Labels: `text-[11px] uppercase tracking-wider text-slate-400`.
- Values: `text-3xl font-semibold text-slate-100 tabular-nums`.

The mockup's left sidebar and top bar are decorative — the existing app chrome (sidebar, client tabs) already wraps this page and is not rebuilt.

## Page layout

Outer grid with the right rail spanning the full height:

```
┌─────────────────────────────────────────────────┬───────────────────┐
│  Header: title + subtitle + "View Scenario"     │                   │
├─────────────────────────────────────────────────┤                   │
│  KPI band (5 cards)                             │   Key Findings    │
├─────────────────────────────────────────────────┤                   │
│                                                 │   Top Risks       │
│  Fan chart (full width of main column)          │                   │
│                                                 │   Recommendations │
├──────────────────────────┬──────────────────────┤                   │
│  Yearly breakdown table  │  Terminal histogram  │                   │
└──────────────────────────┴──────────────────────┘
```

Concrete Tailwind:

- Outer: `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6`.
- Main column: `flex flex-col gap-6`.
- Right rail: `flex flex-col gap-4`.
- Bottom row inside the main column: `grid grid-cols-2 gap-6`.
- Below `lg` (1024px): right rail stacks below the main column; bottom row collapses to a single column.

### Loading state

The layout renders immediately with skeleton shimmers in each card. The fan-chart region shows a thin progress bar driven by the existing `progress` / `progressTotal` state the orchestrator already manages. No blank flash while the engine runs (typical 2–5s for 1,000 trials). This satisfies acceptance criterion #1.

## Component breakdown

```
src/components/monte-carlo-report.tsx    — orchestrator (kept; body rebuilt)
src/components/monte-carlo/
  report-header.tsx                       — title, subtitle, disabled CTA
  kpi-band.tsx                            — 5-card row
  kpi-card.tsx                            — generic card shell
  success-gauge.tsx                       — radial SVG arc
  fan-chart.tsx                           — chart.js fan chart + overlay
  terminal-histogram.tsx                  — chart.js ending-value distribution
  yearly-breakdown.tsx                    — restyled v1 spread table
  findings-card.tsx                       — right rail: failure % + median delta
  top-risks-card.tsx                      — right rail: static-heuristic risks
  recommendations-card.tsx                — right rail: empty advisor slot
  lib/
    fan-chart-series.ts                   — pure: byYear + deterministic → chart.js datasets
    terminal-histogram-series.ts          — pure: ending-values → binned histogram
    top-risks.ts                          — pure: summary + clientData + planSettings → risks[]
    format.ts                             — $2.4M / $95K / percent formatters (reuse the existing short-currency helper used by cashflow-report if one exists; add it here only if not already exported)
```

Each presentational component is under ~150 lines and takes fully-resolved props so it is easy to render in isolation. State (fetching, running, seed, progress, cross-client reset, auto-run) stays entirely in the orchestrator; the `useEffect`-based state-reset and auto-run logic already committed to `monte-carlo-report.tsx` is preserved verbatim.

## Fan chart — the centerpiece

### Data flow

Pure helper `buildFanChartSeries(summary.byYear, deterministicLiquidAssets)` returns six chart.js datasets in this exact order (chart.js `fill: '-1'` is relative, so order is load-bearing):

1. p5 baseline — invisible line, no fill (floor for dataset 2).
2. p95 outer band — `fill: '-1'`, `rgba(148, 163, 184, 0.18)` (slate-400 @ 18%) — the "Lower Bounds" layer.
3. p20 baseline — invisible (floor for dataset 4).
4. p80 inner band — `fill: '-1'`, `rgba(52, 211, 153, 0.35)` (emerald-400 @ 35%) — "Higher Outcomes".
5. p50 median — solid 2px line, `rgb(110, 231, 183)` (emerald-300).
6. Deterministic overlay — 2px dashed line, `rgb(148, 163, 184)` (slate-400), labeled "Cash Flow Projection".

X axis = client age derived from `byYear[i].age.client`. Y axis = dollars formatted via the existing `$2.4M` / `$800K` short-format helper. If the plan has a spouse with different ages, the client's age is used; spouse age is surfaced in the tooltip.

The deterministic series is produced by running `runProjection(clientData)` once at the orchestrator level and passing the resulting per-year liquid-assets array down. This satisfies acceptance criterion #3 and avoids recomputation.

### Annotations

- **Retirement-age marker** — vertical dashed line + emerald cap + label ("Retirement — age N"), using the existing `timelineMarkersPlugin` pattern from `cashflow-report.tsx`. Source: `clientData.client.retirementAge`. If spouse exists and has a different retirement age, a second marker in sky (Timeline's "life" color) for visual distinction.
- **Terminal-age callouts** — p95 / p50 / p5 dollar values rendered as small right-edge labels (the `$3.0M / $2.4M / $1.0M` in the mockup). Implemented as a chart.js plugin `terminalCalloutsPlugin` colocated in `fan-chart.tsx`, ~30 lines.
- **Current projection label** — the floating "Current Projection / 90% Confidence Interval" pill in the mockup is a static absolute-positioned element over the chart container (not a chart.js tooltip). Rendered once, visible on load, roughly mid-chart above the p50 line.
- **Hover tooltip** — chart.js tooltip with dark-theme styling copied from `cashflow-report.tsx`. Shows all five percentiles + the deterministic value at the hovered age, e.g. "Age 75 — p95 $3.1M · p80 $2.7M · p50 $2.2M · p20 $1.7M · p5 $1.2M · deterministic $2.1M".

### Legend

Custom (not chart.js's built-in) — three dots + labels top-right of the chart card:

- slate dot — "Lower Bounds"
- emerald dot — "Higher Outcomes"
- emerald solid line — "Median"
- slate dashed line — "Cash Flow Projection"

## KPI band

Five cards in a single row: `grid grid-cols-5 gap-3`. Card shell = the jewel-accent surface (`bg-slate-900/60 ring-1 ring-slate-800`).

| # | Label                   | Value                                        | Source                                                                                                                                        | Visual                   |
|---|-------------------------|----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|--------------------------|
| 1 | Success Probability     | `88%`                                        | `summary.successRate * 100`                                                                                                                    | radial gauge (see below) |
| 2 | Median Portfolio Value  | `$2.4M`                                      | `summary.ending.p50`                                                                                                                            | big number               |
| 3 | Annual Income           | `$95,000`                                    | sum of `clientData.incomes[]` amounts active in the plan's start year                                                                           | big number               |
| 4 | Start Age               | `60`                                         | `planSettings.planStartYear − yearOfBirth(clientData.client.dateOfBirth)` via the existing age util                                            | big number               |
| 5 | Simulations             | `5,000`                                      | `summary.trialsRun`, comma-formatted                                                                                                            | big number               |

Typography: label = `text-[11px] uppercase tracking-wider text-slate-400`; value = `text-3xl font-semibold text-slate-100 tabular-nums`.

### Success gauge

180° SVG arc, ~160×90px, rendered inside card 1 beside the `88%` label.

- Track arc: slate-800 background stroke, 10px wide, 180° from left to right.
- Fill arc: same geometry, stroke is a linear gradient (rose-400 → amber-400 → emerald-400). `stroke-dasharray` based on percentage.
- Small emerald circle at the tip of the filled portion (the "needle").
- The `88%` number is positioned absolute in the center of the arc, `text-3xl font-semibold tabular-nums`.

Implementation contract:

- Props: `{ value: number }` where value ∈ [0, 1].
- File: `src/components/monte-carlo/success-gauge.tsx`.
- Target line count: ~40 lines of SVG + math.

### Aborted-trials edge case

If `summary.aborted` is true, show a subtle `⚠ partial` badge under the Simulations card. Engine abort is rare but possible (timeout or user cancel).

## Right rail

Three stacked cards, same surface and shadow, `flex flex-col gap-4`.

### 1. Key Findings & Insights

- **Probability of Failure** — `(1 - successRate) * 100`%. Subtitle for concreteness: e.g. "`48 of 1,000 trials ran out of money`".
- **Est. Median Value** — `summary.ending.p50`. Directly below, a delta vs the deterministic ending liquid-asset value: `+$95,000` in emerald if positive, `−$XXXk` in rose if negative. Uses the deterministic run already produced for the fan-chart overlay — no recomputation.

### 2. Top Risks

Bullet list of up to three risks, each with an emerald / amber / rose dot and a short label. Computed by a pure helper:

```ts
// src/components/monte-carlo/lib/top-risks.ts
computeTopRisks(summary, clientData, planSettings) -> Risk[]

heuristics (v2, static):
  - planSettings.inflationRate > 0.035                       -> { label: "High Inflation", tone: "amber" }
  - byYear[min(10, byYear.length - 1)].balance.p5 < byYear[0].balance.p50
                                                              -> { label: "Early Bear Market", tone: "rose" }
  - planSettings.planEndAge > 95                              -> { label: "Longevity", tone: "amber" }
```

If none fire, render a muted "No elevated risks detected" line instead of an empty list.

### 3. Recommendations

Empty state for v2. Card body:

- Headline: "AI-generated recommendations coming soon."
- Body copy: "Advisor insights will appear here based on your plan's risk profile."
- A small sparkle glyph in the bottom-right corner, emerald-tinted.

If `lucide-react` is already installed, use its `Sparkles`; otherwise inline a tiny SVG sparkle — do not add a dep for one icon. Mark the content area with a `{/* TODO: advisor-generated content */}` comment.

## Terminal histogram (bottom-right)

Ending-portfolio-value distribution across all trials — the shape the percentiles summarize.

### Data

- Read `result.byYearLiquidAssetsPerTrial.at(-1)` at the orchestrator level and pass down as `endingValues: number[]`. Avoids changing the summary contract.
- Pure helper `buildHistogramSeries(endingValues)` → `{ bins: [{ min, max, count }], p5, p50, p95 }` with 20 equal-width bins from min to max.

### Chart

- chart.js `Bar`, single dataset.
- Bar color: `rgba(52, 211, 153, 0.6)` (emerald, consistent with fan-chart upper band).
- X axis: formatted dollar labels at bin centers.
- Y axis: hidden. Trial counts are not domain-meaningful at this zoom; the shape is.
- Three vertical dashed lines overlaid via a micro chart.js plugin: p5 (rose), p50 (emerald, bold), p95 (slate).
- Card title: "Ending Portfolio Distribution". Subtitle: "`N = <summary.trialsRun> trials`".

If `summary.aborted`, still render with whatever trials ran — `trialsRun` gives an accurate N.

## Yearly breakdown table (bottom-left)

Preserve v1's Monte Carlo Asset Spread table columns exactly. Only typography and surface change:

- Card surface matches the rest (`bg-slate-900/60 ring-1 ring-slate-800`, rounded, single soft shadow on the card not per-row).
- Header row: `text-[11px] uppercase tracking-wider text-slate-400`.
- Body rows: `text-sm`; money columns `tabular-nums text-right`; age/year columns left-aligned.
- Row divider: thin `divide-y divide-slate-800`. No heavy borders.
- Hover: `hover:bg-slate-800/40`.

No column changes, no filtering UI, no sorting in v2.

## State and data flow

The orchestrator (`monte-carlo-report.tsx`) already does the following and must continue to:

- Fetch `clientData` and the MC payload in parallel on mount and on `clientId` change.
- Reset all per-client state synchronously when `clientId` changes (already committed in `50c85ce`).
- Auto-run on `(clientData, mcPayload)` availability, guarded against repeat firing (already committed).
- Expose a "Restart (new seed)" button that POSTs to `/api/clients/[id]/monte-carlo-data` for a fresh seed and re-runs.

The rebuild adds:

- A single `runProjection(clientData)` call memoized on `clientData` identity, producing the deterministic per-year liquid-asset series used for both the fan-chart overlay and the Findings delta.
- Prop plumbing down to the subcomponents — no context, no zustand, no new state libraries.

## Testing

Pure helpers are unit-tested (vitest). Components get minimal smoke tests. No e2e in v2.

### Pure helper unit tests

- `fan-chart-series.test.ts` — asserts six datasets in the exact order/shape chart.js expects; `fill: '-1'` references resolve correctly; missing deterministic data omits the overlay dataset cleanly.
- `top-risks.test.ts` — one case per heuristic, one case where none fire (returns the empty-state sentinel), one case where all three fire (stable order).
- `terminal-histogram.test.ts` — binning correctness: 20 bins, counts sum to N, bin edges span exactly min→max, p5/p50/p95 positions computed correctly.
- `success-gauge.test.ts` — dasharray proportion asserts at 0%, 50%, 88%, 100% (SVG DOM assertions, not snapshots).

### Component smoke tests

- `monte-carlo-report.test.tsx`:
  - Renders without crashing given a minimal fixture.
  - Shows skeletons while running.
  - Shows gauge + fan chart once summary arrives.
  - Regression test: changing `clientId` clears previous summary synchronously (locks in the fix from `50c85ce`).

### Non-regressions

- `npx tsc --noEmit` clean across the worktree.
- Existing 659 engine tests unchanged (v2 does not touch `src/engine/**`).
- The three pre-existing timeline test failures (`src/components/timeline/__tests__/timeline-report-view.test.tsx`) remain unchanged — not in v2's scope.

## Build checkpoints

Per the handoff process rule: stop and show progress to the user after each of these milestones, before continuing:

1. After the KPI band renders with real data.
2. After the fan chart renders with real data and the deterministic overlay.
3. After the right rail renders with the three cards populated.

Final pass afterwards: terminal histogram, table restyle, loading skeletons, responsive breakpoint, visual polish.

## Deferred work

Appended to `docs/FUTURE_WORK.md` when the first checkpoint lands, each with a one-line "Why deferred" note:

- Variables / interactive scenario panel — what-if plan editing; separate feature, not MC rendering.
- "View Scenario" CTA behavior — destination TBD; button renders visible-but-disabled.
- AI-generated recommendations card content — advisor-authored, not code-generated.
- Real Top Risks attribution engine — current heuristics are static.
- Web Worker MC execution — main-thread performance is adequate at 1,000 trials.
- Correlation admin UI — editing correlations via UI; DB-edit only for now.
- Per-plan required-minimum-asset-level column — hardcoded to 0 in the MC data route.
- Inflation randomization — inflation-tied accounts remain fixed-rate per v1 scoping.

## Acceptance criteria traceability

| # | Handoff criterion                                                                    | Covered by                                          |
|---|--------------------------------------------------------------------------------------|-----------------------------------------------------|
| 1 | Auto-run on tab open, no blank flash, progress visible during trials                 | Page layout → Loading state                         |
| 2 | All core mockup elements present (gauge, KPI band, fan chart, right rail findings)   | KPI band + Fan chart + Right rail                   |
| 3 | Deterministic overlay on fan chart makes diversification gap visible                 | Fan chart → Data flow (dataset #6)                  |
| 4 | Reseeding updates all visuals simultaneously                                          | State and data flow — orchestrator unchanged         |
| 5 | Client switch cleanly resets entire report (no regression)                           | Orchestrator state reset preserved + regression test |
| 6 | `npx tsc --noEmit` clean; existing 659 engine tests pass unchanged                   | Testing → Non-regressions                           |
| 7 | Visual quality: deliberately designed, not default admin panel                       | Entire design, built on the Timeline jewel system    |
