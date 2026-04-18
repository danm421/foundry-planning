# Handoff prompt: Investments report suite (start with Asset Allocation Report)

Paste the block below into a fresh Claude Code session in foundry-planning.
A design mockup will be attached to the new session — reference it for visual
direction.

---

## Prompt to paste

I'm starting a new feature: an **Investments Suite** of reports for the
foundry-planning app. Phase 1 = **Asset Allocation Report**. Before writing
code, read `AGENTS.md` in the repo root (Next.js 16 has breaking changes —
check `node_modules/next/dist/docs/` for Next-specifics) and `docs/FUTURE_WORK.md`
(the Investments report is already listed there). I've attached a design
mockup to this session — treat it as the target look-and-feel, not a pixel
spec.

**Working directory:** `/Users/dan-openclaw/Workspace/foundry-planning`
**Branch:** `main` is clean and up to date. Create a new branch
`investments-report-asset-allocation` and do one logical commit per phase so
the work is revertable.

**Stack:** Next.js 16 App Router, React 19, Tailwind 4, drizzle-orm, vitest,
Chart.js. Run `npx tsc --noEmit` and `npx vitest run` after substantive
changes; `npm run build` before declaring done.

### What already exists (don't rebuild this)

- **Capital market assumptions (CMAs)** — `asset_classes` table holds
  firm-level CMA rows (return, volatility, tax-bucket mix). See `/cma` page
  and `src/app/api/cma/` routes.
- **Model portfolios** — `model_portfolios` + `model_portfolio_allocations`
  tables, editable at `/cma`. Each portfolio is a weighted list of asset
  classes.
- **Per-account asset mix** — `accounts.growth_source` can be `asset_mix`,
  `model_portfolio`, `custom`, or `default`. When `asset_mix`, the mix lives
  in `account_asset_allocations (account_id, asset_class_id, weight)`. The
  asset-mix editor is the "Asset Mix" tab in the account dialog (see
  `src/components/forms/asset-mix-tab.tsx`).
- **Client-level CMA overrides** — `client_cma_overrides` lets a client
  override firm-level CMAs if `plan_settings.use_custom_cma = true`.

Result: every account that opts into `asset_mix` produces a breakdown by
asset class. That's the raw material for this report.

### Goals

Build an **Asset Allocation Report** page that surfaces, for the current
household:

1. **Household allocation pie/donut** — aggregated across all accounts with
   asset mix data. Weighted by current account value.
2. **Per-account allocation table** — each account with its asset class
   breakdown, account value, and a mini bar/sparkline for the mix.
3. **Benchmark comparison** — at least two benchmarks from the mockup's
   "Allocation Details & Benchmarks" panel (e.g., "Target 60/40", "Global
   Market"). Start with two hardcoded ones; structure the code so more can
   be added later.
4. **Sector overview** (mockup right column) — if the CMA asset classes
   have sector metadata we already store, use it; otherwise flag as a
   follow-on item (don't invent sector classifications).
5. **Performance highlights** — 1-year return, Sharpe ratio, max drawdown
   derived from CMA data (geometricReturn, volatility). Sharpe ratio needs
   a risk-free assumption — use 3% as default or pull from `plan_settings`
   if there's a field.
6. **Download PDF** button (can be wired to an empty handler for Phase 1;
   don't implement the PDF yet — add a TODO).
7. **Advisor Comment** button (opens a text-input modal, stored in a new
   `report_comments` table keyed by `(client_id, scenario_id, report_key)`).
8. **Risk-Adjusted View toggle** (mockup bottom-right) — swaps the
   highlighted metric from nominal return to risk-adjusted (Sharpe).

### Out of scope for Phase 1

- Monte Carlo bands or probability-of-success overlays.
- Alternative benchmarks editor (advisors can't yet add their own).
- Per-account drill-in page.
- Server-rendered PDF export.
- Asset allocation extraction from statements (listed separately in
  `FUTURE_WORK.md`).

### Design direction (from mockup)

- **Dark theme matches the rest of the app** — `bg-gray-900` / `bg-gray-800`
  surfaces, gray-700 borders, blue/green/amber accents. Use the existing
  Tailwind palette, don't introduce new colors.
- **Three-column layout**:
  - Left: "Allocation Details & Benchmarks" — table with Current Portfolio,
    Target 60/40, Global Market bars side-by-side per asset class.
  - Center: Donut chart for current allocation + a sectors treemap below
    (treemap can be a follow-on if it's non-trivial).
  - Right: Sector Overview pills (colored category tiles with percentages)
    + Performance Highlights card (1-Year Return, Risk, Max Drawdown).
- **Header** reads "ASSET ALLOCATION REPORT" in uppercase, with Current
  Net Worth and the advisor/household name (use the existing nav convention
  — see `src/app/(app)/clients/[id]/layout.tsx`).
- **Bottom bar** with Download PDF, Advisor Comment, Risk-Adjusted View
  toggle.

### Architecture suggestions

- **Route:** `src/app/(app)/clients/[id]/investments/page.tsx` — a new
  top-level plan page alongside Balance Sheet and Cash Flow. Add a tab in
  `src/app/(app)/clients/[id]/layout.tsx`:
  `{ label: "Investments", href: "investments" }`.
- **Data fetching:** Server component that hydrates accounts + asset
  allocations + model portfolio fallbacks + asset classes, then passes to
  a client component `InvestmentsReportView`.
- **Compute allocation:** write a pure function
  `computeHouseholdAllocation(accounts, allocations, modelPortfolios,
  assetClasses) -> { byAssetClass: { id, name, value, pctOfPortfolio }[],
  total }`. Unit-test it — this is the load-bearing math.
- **Benchmark comparison:** define benchmarks in `src/lib/benchmarks.ts`
  with shape `{ id, name, weights: { assetClassSlug: pct }[] }`. Start
  with Target 60/40 (60 equity / 40 bond) and Global Market (from
  vanguard/msci default). Resolve at render time by slug against
  the firm's asset classes.
- **Chart library:** Chart.js is already in use (`src/components/cashflow-report.tsx`).
  Use `Doughnut` chart. For the treemap, either `chartjs-chart-treemap` or
  plain Tailwind flex boxes.
- **Risk-adjusted metrics:** Sharpe = (expectedReturn - riskFreeRate) /
  volatility. Use `geometricReturn` from the weighted blend. Max drawdown
  is harder — approximate with `-2 * volatility` for Phase 1 and flag the
  approximation in the UI.

### Phasing

Break the work into these commits (roughly):

1. **Phase 1a — route + empty shell.** New `investments/page.tsx`,
   top-nav tab, empty layout grid matching the mockup.
2. **Phase 1b — allocation math + tests.** `computeHouseholdAllocation`,
   benchmarks file, unit tests.
3. **Phase 1c — donut + allocation table.** Render the center donut and
   the left benchmark-comparison table.
4. **Phase 1d — sector overview + performance highlights.** Right column
   pills + Sharpe/drawdown card.
5. **Phase 1e — advisor comment dialog.** Schema migration for
   `report_comments`, POST/GET route, modal.
6. **Phase 1f — risk-adjusted toggle + PDF stub.** State toggle that
   swaps highlighted metric; PDF button with a disabled TODO.

### Workflow

1. Confirm scope with me before coding. Flag anything ambiguous — especially:
   - Do I want sector overview if we don't already track sectors on asset
     classes? (If not, you'll need to either add it or defer that panel.)
   - Is the donut OK or do I want the treemap too?
   - Which benchmarks should we ship with on day 1?
2. Create branch `investments-report-asset-allocation` off main.
3. Phase-by-phase commits, small focused messages:
   `feat(investments): scaffold asset allocation report page`,
   `feat(investments): household allocation math + tests`, etc.
4. For items needing a design conversation (e.g. benchmark data shape,
   report_comments schema), use the `superpowers:brainstorming` skill.
5. Typecheck + tests after every commit. Build once at the end before
   pushing.
6. When done, summarize what shipped, what's deferred, and any
   follow-up items for the rest of the Investments suite.

### Things NOT to do

- Don't add alpha/beta, CAPM, or modern portfolio theory optimizers —
  those belong to a later report in the suite.
- Don't add new asset classes or portfolios; use what's in the DB.
- Don't build a PDF export engine — stub the button.
- Don't touch the balance sheet report (`src/components/balance-sheet-report/`)
  or the cashflow report (`src/components/cashflow-report.tsx`) unless a
  shared component makes sense — if so, extract it.
- Don't invent sector data if it's not already stored; ask me first.

### Reference files

- `src/app/api/cma/` — CMA + model portfolio routes.
- `src/components/forms/asset-mix-tab.tsx` — per-account allocation UI.
- `src/components/balance-sheet-report/` — pattern for a read-only report
  page (layout, PDF stub, etc.) that you can mirror.
- `src/engine/types.ts` — `Account`, `AccountLedger` shapes.
- `docs/FUTURE_WORK.md` — broader project roadmap.

Start by reading `AGENTS.md`, `docs/FUTURE_WORK.md`, and the attached
mockup, then confirm scope with me before writing code.
