# Investments Suite — Phase 1: Asset Allocation Report

## Summary

A new top-level plan tab (`Investments`) with a single report for Phase 1: **Asset
Allocation Report**. Rolls up every investable account in the household and
compares its asset-class mix against a target model portfolio the advisor picks.
Builds foundations (math, layout, selector persistence, comment dialog) that
later reports (sectors, performance, Monte Carlo) can extend without
restructuring.

## Scope

**In scope (Phase 1):**

- New route `/(app)/clients/[id]/investments` and nav tab.
- Allocation donut for the household's investable portfolio.
- Two-column allocation details table (Current vs Target), with mini bars.
- Benchmark selector (advisor picks any existing model portfolio; selection
  persists on `plan_settings`).
- Drift chart (Current − Target, per asset class) in a modern horizontal
  diverging-bars treatment.
- Advisor comment dialog, persisted to a new `report_comments` table keyed by
  `(client_id, scenario_id, report_key)`.
- Download PDF button (stub — empty handler + TODO).
- Disclosure line: "Investable assets only. Excludes $Y in business / real
  estate; $Z in accounts without an asset mix." (clauses conditionally
  hidden when $Y or $Z is zero.)

**Out of scope (deferred):**

- Sector overview / sector metadata on asset classes. (Foundations built so a
  future report can add it without rearchitecture.)
- Treemap visualization.
- Hardcoded reference benchmarks (60/40, Global Market).
- Performance Highlights (1-yr return, Sharpe, max drawdown).
- Risk-Adjusted View toggle (dropped with Performance Highlights — no metric
  to toggle).
- Real PDF export.
- Per-account drill-in page.
- Monte Carlo overlays, alpha/beta, MPT optimizers.
- Drift threshold alerts.
- Asset allocation extraction from statements (tracked separately in
  `FUTURE_WORK.md`).

## Data model changes

Two changes, one migration (drizzle-kit generate + migrate):

1. **`plan_settings.selected_benchmark_portfolio_id`** — new column,
   `uuid references model_portfolios(id) on delete set null`. Nullable. When
   null, the benchmark-comparison column and drift chart render empty states
   and nudge the advisor to pick a target.
2. **New table `report_comments`:**
   - `id uuid primary key`
   - `client_id uuid not null references clients(id) on delete cascade`
   - `scenario_id uuid not null references scenarios(id) on delete cascade`
   - `report_key text not null` (short string like
     `'investments_asset_allocation'`; table is reused by future reports)
   - `body text not null default ''`
   - `created_at`, `updated_at` timestamps
   - Unique index on `(client_id, scenario_id, report_key)`

No changes to `asset_classes`, `accounts`, `account_asset_allocations`,
`model_portfolios`, or `model_portfolio_allocations`. Asset-class `slug` is
already present for future benchmark-library work but is not required for
Phase 1 because the benchmark comes from a real model portfolio (asset-class
IDs resolve directly).

## Architecture

### Route and components

- **`src/app/(app)/clients/[id]/investments/page.tsx`** — server component.
  Reads (for the active scenario): scenario row, accounts, asset allocations,
  model portfolios, model-portfolio allocations, asset classes, plan_settings,
  existing report_comment for `investments_asset_allocation`. Computes the
  household allocation via pure functions below, passes shaped props to the
  client component.
- **`src/app/(app)/clients/[id]/investments/investments-client.tsx`** —
  client component. Owns transient UI state (comment modal open/closed,
  dropdown open/closed). Delegates benchmark persistence and comment save to
  dedicated API routes.
- **Nav tab:** add `{ label: "Investments", href: "investments" }` to the tab
  array in `src/app/(app)/clients/[id]/layout.tsx`, slotted before Settings.

### Pure-logic module

**`src/lib/investments/allocation.ts`** (unit-tested in vitest):

- `resolveAccountAllocation(account, mixRowsByAccountId, modelPortfolios,
  modelPortfolioAllocationsByPortfolioId, planSettings) → { classified: {
  assetClassId, weight }[] } | { unallocated: true }` — walks the growth-source
  chain. Priority: account's own `growth_source` → (if `default`)
  `plan_settings.growthSource{Taxable,Cash,Retirement}` based on the account's
  category → resolves to either explicit `account_asset_allocations` rows or a
  `model_portfolio_id`'s allocations. If the terminal state is `custom` or
  there are no matching rows, returns `{ unallocated: true }`. Weights always
  sum to 1.0 when classified.
- `computeHouseholdAllocation(investableAccounts, resolver, assetClasses) → {
  byAssetClass: [{ id, name, value, pctOfClassified }], unallocatedValue,
  totalClassifiedValue, totalInvestableValue, excludedNonInvestableValue }`
  — iterates accounts, rolls resolved weights × account.value into a
  per-asset-class map, tallies unallocated dollars separately, reports total
  investable and excluded-non-investable sums for the disclosure line.
- `computeDrift(current, target) → [{ assetClassId, name, currentPct,
  targetPct, diffPct }]` — union of asset classes present in either side;
  missing side treated as 0. Sort order: largest absolute drift first (UI can
  re-sort if needed).

**`src/lib/investments/benchmarks.ts`:**

- `resolveBenchmark(portfolioId, modelPortfolios,
  modelPortfolioAllocationsByPortfolioId) → [{ assetClassId, weight }] | null`
  — reads a model portfolio's allocations; returns null if the portfolio id
  isn't found (deleted/unset). Kept as its own module so the future "firm
  reference benchmarks" feature can drop in a second resolver without
  touching the report.

**`src/lib/investments/palette.ts`:**

- `colorForAssetClass(assetClass) → string` — deterministic Tailwind color
  token (e.g., `bg-sky-500`, `bg-emerald-500`) keyed off `sortOrder` so the
  same asset class renders the same swatch across donut, table, and drift
  chart. Stable across re-renders.

### Investable filter

An account is **investable** when all of the following are true:

- `accounts.category ∈ {cash, retirement, taxable}`
- `accounts.ownerEntityId is null` (exclude out-of-estate for Phase 1;
  OOE-investable accounts are a later decision).

Excluded dollars (business, real estate, life insurance, OOE) are summed into
`excludedNonInvestableValue` and surfaced in the disclosure line — never
silently dropped.

### API routes

- **`src/app/api/clients/[id]/report-comments/route.ts`** — `GET` (query:
  `scenarioId`, `reportKey`), `PUT` (body: `scenarioId`, `reportKey`, `body`).
  Upsert semantics on `(client_id, scenario_id, report_key)`.
- **Benchmark selector persistence** — extend the existing `plan_settings`
  update endpoint (or add a focused PATCH route if none exists); the
  selector calls it on change with `{ selectedBenchmarkPortfolioId }`.

## UI layout

Three-column grid on ≥1024px (`lg:grid-cols-[1fr_1.1fr_1fr]`), stacks on
narrower screens. Dark app surfaces (`bg-gray-900` / `bg-gray-800`),
`border-gray-700`, existing accent palette.

**Header:**
- Breadcrumb: `Reports > Investments > Asset Allocation`.
- Title: `ASSET ALLOCATION REPORT` uppercase.
- Right: "Target Portfolio" dropdown listing the firm's model portfolios;
  selection persists to `plan_settings.selected_benchmark_portfolio_id`.
  Placeholder when unset.

**Left — Allocation Details:**
- Table, one row per asset class (union of Current + Target).
- Columns: color swatch + name · Current % (with inline mini bar) · Target %
  (with inline mini bar).
- Unallocated pinned at bottom (italic, gray) when present.
- Sort: Current % descending.

**Center — Donut + totals:**
- Chart.js Doughnut, slice per asset class, Unallocated as neutral gray.
- Big number above: `Investable Total: $X`.
- Disclosure line below: `Excludes $Y in business / real estate; $Z in
  accounts without an asset mix.` (either clause hidden when zero).
- No redundant legend — the left table serves that role.

**Right — Drift chart:**
- Horizontal diverging bars (asset classes down the y-axis, center zero line).
- Bars > 0 → teal, bars < 0 → amber. Value label at bar end.
- Minimal chrome: no chart border, axis ticks only at 0.
- Below the chart, a compact `(swatch · name · ±X.XX%)` list doubles as a
  legend.
- Empty state when no target selected: `Select a target portfolio to see
  drift.`

**Bottom bar:**
- `Download PDF` button — empty handler + TODO comment. No engine yet.
- `Advisor Comment` button — opens modal with textarea, Save/Cancel. Persists
  to `report_comments`. A small dot indicator on the button when a comment
  exists.

## Phasing

Six commits on branch `investments-report-asset-allocation` (already created).
Each phase ends with `npx tsc --noEmit` and `npx vitest run` green; `npm run
build` runs once before any push.

1. **1a — Scaffold.** Route, client shell, nav tab. Empty three-column grid
   with placeholder cards. No data fetch yet.
2. **1b — Allocation math + tests.** `allocation.ts`, `benchmarks.ts`,
   `palette.ts` + vitest. Test cases: asset_mix account, model_portfolio
   account, default-resolves-via-plan-settings, fully unallocated account,
   OOE account excluded, business/real-estate excluded, benchmark drift
   union, empty-benchmark returns null.
3. **1c — Donut + allocation table + benchmark selector + migration.**
   Drizzle migration (both schema changes together), server component
   fetches real data, donut + left table + header selector rendered.
   Benchmark selection persists on change. Drift column still empty state.
4. **1d — Drift chart.** Horizontal diverging bars + legend list. Empty
   state when no target selected.
5. **1e — Advisor comment dialog.** `POST/GET /api/clients/[id]/report-comments`,
   modal component, dot indicator on button.
6. **1f — PDF stub + disclosure polish.** Empty-handler PDF button with TODO
   comment, final copy pass on disclosure line, FUTURE_WORK.md entry updated
   per AGENTS.md convention.

Both schema changes land in **phase 1c** (one migration file) even though the
comment dialog code doesn't land until 1e — simpler CI / one-shot migration.

## Testing

- **Unit tests (vitest):** every pure function in
  `src/lib/investments/allocation.ts` and `benchmarks.ts`. Focus on the
  growth-source resolution chain and the drift union logic since those are
  the load-bearing behaviors.
- **Typecheck after every commit:** `npx tsc --noEmit`.
- **Build before push:** `npm run build`.
- **No React Testing Library.** Manual smoke test of the rendered page via
  `npm run dev` before final commit — tracks existing repo practice (RTL is
  a deferred tooling item).

## Explicit non-goals for math

- No Sharpe, volatility, max drawdown, or 1-year return computation.
- No alpha/beta, CAPM, MPT.
- No drift-threshold alerting.
- No correlation matrix.
- No Monte Carlo.

## Follow-ups (not part of Phase 1)

- Sector metadata on asset classes + Sector Overview panel.
- Firm-level reference benchmarks (60/40, Global Market) as a separate
  library in `benchmarks.ts`, pickable alongside model portfolios.
- Real PDF export (wire the stubbed button).
- Performance Highlights card (requires a CMA-aware blended-return module).
- Drift-threshold advisor alerts (e.g., "US Equity overweight by > 5%").
- Per-account drill-in page.
- Out-of-estate investable rollup (currently excluded; when OOE-accounts
  should appear in the investable pie is a later design conversation).

## Reference files

- `src/db/schema.ts` — existing asset-class, model-portfolio, account,
  plan-settings schemas.
- `src/components/forms/asset-mix-tab.tsx` — per-account allocation UI.
- `src/components/balance-sheet-report/` — pattern for a read-only report
  page (layout, header, columns) to mirror.
- `src/engine/types.ts` — `Account` shape.
- `docs/FUTURE_WORK.md` — broader roadmap; remove the "Investments report"
  entry in phase 1f.
- `docs/superpowers/specs/2026-04-18-investments-report-prompt.md` — original
  handoff; this design doc supersedes it with the refined scope.
