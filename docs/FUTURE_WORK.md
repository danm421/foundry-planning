# Future Work

Lightweight running list of items deferred from past sessions. Add a new entry
when you consciously scope something out; remove the entry when it ships.
Format: one line per item plus a short "Why deferred" note.

Items are scored on three axes:

- **P (Priority)** 1–10: how important/urgent
- **E (Ease)** 1–10: how easy to implement (10 = few hours)
- **L (Leverage)** 1–10: how much other work this unlocks

## Suggested Order

Filtered to P ≥ 4 and sorted by P+E+L. Items below this cutoff are genuinely
backlog; some of them (family members as owners, per-entity tax fields) are
enablers and should ship folded into their parent feature.

| # | Item | P | E | L | Total |
|---|------|---|---|---|-------|
| 1 | Scenario switcher + side panel | 9 | 2 | 8 | 19 |
| ~~2~~ | ~~Asset mix tab on investment accounts~~ | — | — | — | SHIPPED |
| 3 | Roth conversion optimizer (now unblocked) | 7 | 5 | 5 | 17 |
| 4 | Year-by-year schedule for incomes & expenses | 7 | 5 | 4 | 16 |
| ~~5~~ | ~~Investments report (asset allocation)~~ | — | — | — | SHIPPED |
| 6 | Assumption library | 4 | 6 | 6 | 16 |
| 7 | Monte Carlo / probability of success | 8 | 4 | 3 | 15 |
| 8 | UI/UX refresh for Income/Expenses/Savings tabs | 6 | 5 | 4 | 15 |
| 9 | Amortization table + extra payments on liabilities | 6 | 5 | 4 | 15 |
| 10 | Asset allocation extraction from statements | 6 | 4 | 5 | 15 |
| 11 | Plan PDF export | 5 | 6 | 4 | 15 |
| 12 | CSV export for reports (cross-cutting) | 5 | 7 | 3 | 15 |
| 13 | Per-year ledger drill-in for tax tables | 6 | 5 | 3 | 14 |
| 14 | SS claiming optimizer | 5 | 6 | 2 | 13 |
| 15 | Client-facing read-only view | 4 | 6 | 3 | 13 |
| 16 | Trust/estate brackets (data ready) | 4 | 7 | 2 | 13 |
| 17 | Trust taxes for non-grantor entities | 5 | 4 | 3 | 12 |
| 18 | IRMAA tiers in tax engine | 5 | 4 | 3 | 12 |
| 19 | Estate planning report | 7 | 2 | 3 | 12 |
| 20 | Plan vs actual tracking | 4 | 4 | 3 | 11 |
| 21 | State-level bracket tax | 5 | 2 | 4 | 11 |

Dependency notes that override raw score:

- Ship **deduction types before the Roth optimizer** — the optimizer needs
  real above-line deductions to honestly compute "how much bracket room is left."
- Ship **family members as owners before estate report** (enabler, P3/L6).
- Start the **scenario switcher design doc** in parallel with other work — it's
  the biggest lift and benefits from early design pressure.
- **Trust/estate brackets** are a tiny add since the data is already in the
  seed workbook; they unlock the **trust taxes for non-grantor** work.
- **Year-by-year schedules + Amortization/extra payments + UI refresh** all
  touch the Income/Expenses/Savings/Liabilities forms — ship as one
  coherent Client Data refresh once we're ready to revisit those tabs.
- ~~Ship **asset mix tab before Investments report**~~ — DONE. Asset mix
  tab shipped; **Investments report** and **asset allocation extraction**
  are now unblocked.

## Client Data

- **Account history tracking (balance sheet Phase 2)** _(P5 E4 L4)_ — add
  `account_history` and `liability_history` tables keyed by
  `(account_id / liability_id, as_of_date)` and a History tab on each
  account/liability in Client Data → Balance Sheet. Three capture
  mechanisms: (a) auto-capture on edit (previous balance stamped with
  today's date when the advisor saves a new value), (b) auto-capture on
  `as_of_date` bump, and (c) manual entry for backfilling past year-ends.
  Once shipped, swap the balance-sheet-report view-model's past-year data
  source from projection to history where history rows exist. Unlocks
  meaningful "AS OF 31 Dec 2022" snapshots and honest YoY deltas instead
  of projection-to-projection. Full design in
  `docs/superpowers/specs/2026-04-18-balance-sheet-redesign-design.md`
  (Phase 2 section). _Why deferred: Phase 1 redesign shipped without it —
  report still works using projection data for all years. History is a
  meaningful schema + UI + capture project that should have its own
  brainstorm cycle._

- **Year-by-year schedule for variable incomes & expenses** _(P7 E5 L4)_ —
  today income and expense rows have a flat `annualAmount` plus a growth rate.
  Real plans have items that vary year-to-year (college tuition 2030-2034,
  mortgage payoff cliff, project-based consulting income, etc.). Add a
  per-row "Custom schedule" mode that opens a year-by-year override grid,
  filling in any year not overridden with the calculated growth-rate value.
  Schema: new `income_schedule_overrides` and `expense_schedule_overrides`
  tables (or one polymorphic table) keyed by `(row_id, year)`. Engine reads
  override first, falls back to growth-rate calc. _Why deferred: not yet
  asked, but blocks accurate planning for clients with bursty/lumpy
  cashflows (most HNW clients)._

- **Amortization table tab on liabilities with extra payments** _(P6 E5 L4)_
  — add an "Amortization" tab to the liability data entry screen showing
  the full per-year schedule: payment, interest paid, principal paid,
  ending balance. Within the tab, advisors can add extra principal
  payments (one-time or recurring) and immediately see how they impact
  the payoff timeline and total interest. When saved, the extra payments
  flow through to the cash flow projection — the engine picks them up
  as additional outflows in the appropriate years and adjusts the
  liability balance accordingly. Pairs with mortgage-interest-deduction
  work (same per-year interest math feeds both views). Consolidates the
  former "amortization table" and "extra payment" items into one
  feature. _Why deferred: works around via existing payment field; a
  real schedule + extra-payment modeling is the next layer of polish._

- ~~**Asset mix tab on investment accounts**~~ — **SHIPPED.** Per-account
  asset allocation tab with two modes: "Use model portfolio" (inherits from
  assigned growth model) and "Custom" (manual percentages against CMA asset
  classes). Unblocks the Investments report and asset allocation extraction.

- **Extend `Inflation` growth source to deductions, transfers, asset transactions** _(P3 E6 L2)_ —
  The inflation growth option now exists for cash/taxable/retirement accounts,
  income, expenses, and savings rules. Three other tables carry `growth_rate`
  columns that weren't included in the initial rollout: `client_deductions`,
  `transfers`, and `asset_transactions`. Same mechanical pattern: add
  `growth_source` column with `item_growth_source` enum, extend the loader
  to pre-resolve, add the shared radio widget to those forms.
  _Why deferred: user scope did not include them in the original ask._

- **UI/UX refresh for Income, Expenses, and Savings tabs** _(P6 E5 L4)_ —
  the current forms are functional but feel like a stack of plain inputs.
  Goals: better grouping (active vs. retired income, fixed vs. variable
  expenses), inline summary totals, less visual noise per row, friendlier
  add/remove flow. Pairs naturally with the year-by-year schedule work
  since both are touching these subtabs. _Why deferred: works as-is, but
  spending more time in those tabs (with deduction types and variable
  schedules landing) makes the UX gap more apparent._

## UI

- **Scenario switcher + side-panel editor** _(P9 E2 L8)_ — schema supports
  multiple scenarios per client but the UI always operates on the base case.
  Target UX is a side panel that lets the advisor add/modify/remove data for a
  specific scenario with live recalculation and a diff vs base (including the
  portfolio assets chart on the cash-flow page). Open design question: overlay
  model (base changes propagate, scenario stores only deltas) vs copy model
  (scenario forks at creation). Leaning overlay with a "detach" action. _Why
  deferred: large effort; base case first._

- ~~**Year-range slider on plan pages**~~ — **SHIPPED.** Cashflow page has
  a dual-handle Radix slider with Full / Working Years / Retirement Years
  preset buttons. Filters the chart, the cashflow table (and all drill-downs),
  and the multi-year Tax Detail modal. Slider also mounted inside the modal
  with shared state. Session-only (resets on navigation). Followups: persist
  range across navigation (URL/localStorage/DB), apply to balance sheet and
  income/expenses pages once they render multi-year data, marker overlays for
  retirement/AMT/etc. on the slider track.

- **Per-year ledger drill-in for tax-detail tables** _(P6 E5 L3)_ — clicking a
  cell in the multi-year Tax Detail modal (e.g., "Below Line Deduct" for 2028)
  should open a per-year breakdown showing what composes that field (std
  deduction, charitable gifts, SALT, etc.). Paired with deduction-types work:
  only meaningful once itemized components exist in the model. _Why deferred:
  the drill-down currently only wires the per-source tax ledger for total
  income/tax categories; per-cell breakdown for deductions and flow fields is
  the next layer of detail._

- **Client-facing read-only view** _(P4 E6 L3)_ — shareable link with a
  limited surface (balance sheet, cash-flow chart, plan summary) so advisors
  stop screenshotting into emails. _Why deferred: no advisor has asked;
  auth/sharing model needs design._

- **Plan vs actual tracking** _(P4 E4 L3)_ — yearly snapshot of a plan with a
  projected-vs-actual comparison view. Depends on an import path for actuals.
  _Why deferred: blocked on AI statement import._

- **Out-of-estate liabilities section on balance sheet** _(P3 E8 L2)_ —
  accounts get an amber "Out of Estate" panel grouped by entity; liabilities
  are persisted with `owner_entity_id` and accepted by the form, but still
  display in the main Liabilities list. _Why deferred: not yet requested;
  wanted the assets version in front of the user first._

- **Dedicated entity balance sheets** _(P2 E6 L2)_ — an entity's accounts and
  liabilities currently show up inside the household balance sheet (OOE
  section). Long term it may be cleaner to give each entity its own
  balance-sheet view. _Why deferred: current display is acceptable for
  single-entity cases._

- **Family members as owners** _(P3 E5 L6)_ — `family_members` rows are
  informational only today. Children/grandchildren can't own accounts,
  incomes, or expenses. Prerequisite for the estate report's beneficiary
  graph. _Why deferred: ship as part of estate report work._

- **Audit log / change history** _(P3 E7 L2)_ — "what changed on this plan
  since last meeting?" view. _Why deferred: low priority until advisors
  request it._

## Engine

- ~~**Robust tax engine driven by uploadable tax-year data**~~ — **SHIPPED.**
  `tax_year_parameters` table seeded from the advisor workbook (2022-2026).
  Bracket-based federal tax with progressive brackets for 4 filing statuses,
  LT cap gains 0/15/20% stacking, AMT with exemption phase-out, NIIT, FICA +
  Additional Medicare, QBI (simplified), SS taxability per IRS Pub 915. Opt-in
  per client via `tax_engine_mode` toggle. Multi-year inflation forward-projection
  using plan's tax-inflation and SS-wage-growth rates. Multi-year drill-down UI
  with Income Breakdown and Federal Tax Breakdown tabs, column tooltips, and
  first-year regime-transition indicators. State tax stays flat (MVP).

- ~~**Deduction types**~~ — **SHIPPED.** `client_deductions` table holds
  itemized line items (charitable cash, charitable non-cash, SALT capped at
  $10k, mortgage interest, other itemized). Above-line auto-derived from
  existing savings rules to traditional IRA / 401k accounts. Bracket mode
  is now the default. Followups still in scope for a v2 deductions pass:
  medical expense above 7.5% AGI, student loan interest (capped),
  529 state deduction, IRA deduction phase-out for high earners with
  workplace plan, HSA support (needs HSA account subtype), per-year
  override schedule for deductions.

- **Align `plan_settings.inflation_rate` consumers with the resolver** _(P2 E4 L2)_ —
  The engine still reads `plan_settings.inflation_rate` directly in two places
  unrelated to item growth: tax bracket indexing and SS wage-growth fallback
  (both in `src/engine/projection.ts`). When the advisor picks `asset_class`
  mode on Assumptions, the stored decimal may be stale relative to the AC's
  value. Route those reads through `resolveInflationRate` to eliminate the
  divergence. _Why deferred: they're non-item-growth consumers and the
  original feature ask did not mention them._

- **Trust taxes for non-grantor entities** _(P5 E4 L3)_ — when an entity is
  not flagged `is_grantor`, household taxes are correctly skipped, but the
  entity itself owes tax on its income and RMDs at trust/estate rates (much
  compressed brackets). That tax isn't modeled; the entity's checking grows
  as if pre-tax. Depends on `trust/estate brackets` item below. Replaces the
  old "Non-grantor entity-level taxes" entry now that the tax engine has
  landed — the remaining work is applying the existing trust/estate brackets
  in the engine when `is_grantor === false`. _Why deferred: data in the
  workbook, but engine integration for entity tax tracking is its own project._

- **Trust/estate brackets in tax engine** _(P4 E7 L2)_ — the seed workbook
  already includes trust/estate brackets (10/24/35/37% compressed thresholds),
  but the engine only uses the four individual filing-status brackets.
  Wire the trust brackets into `calculate.ts` so entity-level calcs can use
  them. Small add; mostly plumbing. _Why deferred: no non-grantor entity
  client in production yet driving demand._

- **IRMAA tiers in tax engine** _(P5 E4 L3)_ — Medicare Part B + D premium
  surcharges for retirees whose MAGI (from 2 years prior) exceeds the IRMAA
  thresholds. 6 tiers, separate for Part B and Part D, indexed annually.
  Data source: CMS, not the existing workbook. _Why deferred: MVP tax engine
  scoped out; advisors will increasingly request it as we get more retiree
  clients — retirees who plan drawdowns without IRMAA modeling can get
  surprised by $4k-$10k/year Medicare premium increases._

- **QBI SSTB + W-2 wage cap** _(P4 E3 L2)_ — v1 QBI collapses above-phase-in
  to $0 for everyone. Real Section 199A: above phase-in, SSTB (health, law,
  accounting) gets $0 but non-SSTB gets deduction capped by 50% × W-2 wages
  or 25% × wages + 2.5% × UBIA. Need `is_sstb` flag on business income and
  optional W-2 wage tracking. _Why deferred: under-deducts non-SSTB business
  owners; file when an advisor flags it in real numbers._

- **NIIT: include taxable interest in investment income** _(P3 E6 L1)_ — v1
  NIIT uses `qualifiedDividends + LTCG + STCG` as the investment-income input.
  Taxable interest (from the "ordinary income" bucket) also counts per IRC
  §1411 but isn't surfaced because our `taxDetail.ordinaryIncome` is a blend
  (interest + non-qual div + RMDs + IRA distros). To fix, split the ordinary
  bucket so NIIT can count only the investment-interest portion. _Why
  deferred: small precision bug; hits bond-heavy portfolios. Fix by tracking
  `taxable_interest` as a separate income type in `taxDetail`._

- **AMT credit carryover** _(P2 E4 L1)_ — in real tax, years where AMT
  applies generate a credit that reduces future regular-tax AMT obligations.
  Requires multi-year stateful tracking of AMT paid vs recovered. _Why
  deferred: edge case for most planning clients; significant complexity._

- **State-level bracket tax** _(P5 E2 L4)_ — replace flat state rate with
  per-state progressive brackets. Needs a data-ingestion pipeline covering
  all 50 states + DC (bracket thresholds vary per state, update annually).
  Some states tax LTCG as ordinary (most), some have no state tax (FL, TX,
  etc.), some have local/city tax (NY, NYC). Big data project. _Why deferred:
  flat-rate approximation within ~1% of actual state tax for most clients
  is acceptable for planning-horizon work._

- **Entity withdrawal strategy** _(P2 E5 L2)_ — when an entity's checking
  goes negative, the engine leaves it negative instead of pulling from the
  entity's own retirement/taxable accounts. _Why deferred: adds per-entity
  withdrawal-order configuration; wait for a real case that needs it._

- **Inherited-IRA / edge-case RMDs** _(P3 E6 L2)_ — 10-year rule for
  non-spouse beneficiaries, spouse-beneficiary treatment, QCDs. _Why
  deferred: current RMD code covers the common household case._

- **Employer match when using legacy cash-flow path** _(P1 E8 L1)_ — the
  match amount is computed but never credited to the account in the
  no-default-checking branch. _Why deferred: every real client now has a
  default checking; legacy path exists only for fixtures and pre-migration
  data._

## Analytics

- ~~**Capital market assumptions (CMAs) + model portfolios**~~ — **SHIPPED.**
  Global `/cma` page, asset classes + model portfolios tables, realization-based
  growth splitting in the engine, tax-bucket plumbing that fed into the tax
  engine.

- **Monte Carlo / probability of success** _(P8 E4 L3)_ — stochastic
  projection over N trials using CMA-driven portfolio returns; surface
  probability-of-success and percentile cones on the cash-flow chart. _Why
  deferred: CMAs shipped (unblocking this); defer for now since current
  deterministic projection is advisor-usable and monte carlo is a significant
  compute + UI effort._

- **Roth conversion optimizer** _(P7 E5 L5)_ — recommend annual conversion
  amounts that fill a target bracket across the plan horizon. Now unblocked
  by the tax engine. Best shipped right after deduction types (otherwise the
  optimizer has incomplete bracket room awareness). _Why deferred: tax engine
  just landed; deduction types should ship first so the optimizer can honestly
  compute bracket headroom._

- **Social Security claiming optimizer** _(P5 E6 L2)_ — compare claim ages
  with breakeven analysis and survivor impact. _Why deferred: small but not
  requested yet._

## Reports

- **Estate planning report** _(P7 E2 L3)_ — flow charts showing where each
  asset flows at death, family tree with beneficiary overlays, estate-tax
  breakdown, trust/entity structure diagram. Requires an estate data model
  (bequests, beneficiary percentages, trust provisions) that doesn't map
  cleanly onto the current cash-flow tables. Suggest splitting into: (a)
  estate data model, (b) estate-tax calc, (c) visualization layer. Ties
  into "Family members as owners". _Why deferred: large; depends on
  data-model work._

- **Plan PDF export** _(P5 E6 L4)_ — server-rendered PDF summary of the
  plan (balance sheet, cash flow, assumptions, tax detail). Reportlab
  patterns from `ethos-tools` can be ported. _Why deferred: no advisor has
  asked for a polished export yet._

- **CSV export for reports (cross-cutting)** _(P5 E7 L3)_ — per-table CSV
  download button on cashflow, balance sheet, tax detail, and account
  ledger views. Advisors hand the CSV to CPAs or paste into Excel for
  what-if tinkering. Cross-cutting, not tax-specific. _Why deferred:
  deferred from the tax drill-down work since it applies to all reports;
  better shipped as one coherent project._

- **Holdings-level detail in allocation type-drill** _(P4 E4 L3)_ — the
  type-drill view in the allocation report currently stops at
  account-level contributions under each class. A future revision could
  nest per-holding rows (ticker, CUSIP, units, price, market value) under
  each account. _Why deferred: holdings data model isn't in place yet._

- **Asset-type dimension on drift chart** _(P4 E3 L2)_ — `DriftChart`
  compares current vs target at the asset-class level only. Now that the
  allocation donut + table support an asset-type dimension, rolling drift
  up to the type level is a natural follow-up. _Why deferred: scoped out
  of the asset-type-groups feature to keep it focused on the donut +
  table + drill._

- **Allowlist mutable fields on `PUT /api/cma/asset-classes/[id]`**
  _(P3 E4 L3)_ — the current handler spreads the raw request body into
  Drizzle's `.set()`, which means any schema column (including `firmId`,
  `id`, `createdAt`) could be overwritten by a crafted request. The
  `WHERE firmId = ...` clause prevents cross-firm reads, but a caller
  could corrupt ownership of a record it already has access to. Harden
  by explicitly allowlisting mutable fields. _Why deferred: existing
  behavior predates the asset-type-groups branch and the exploitability
  is low; worth a defense-in-depth fix in a follow-up task._

## Integrations

- ~~**AI statement import in Client Data**~~ — **SHIPPED.** Import tab in
  client-data with drag-and-drop upload, Azure OpenAI extraction for 6
  document types, step-by-step review wizard, and batch commit with
  `source: "extracted"`.

- **Asset allocation extraction from statements** _(P6 E4 L5)_ — extend
  the AI statement import pipeline to detect and extract asset allocation
  data when available in uploaded statements (e.g., brokerage summaries,
  quarterly reports). The extractor maps each holding or asset class to
  the closest matching asset class in the system's CMAs, producing a
  draft allocation the advisor reviews before saving. Feeds directly
  into the per-account asset mix tab (see Client Data section) and the
  Investments report. _Why deferred: statement import works for balances
  and holdings; allocation mapping requires CMA-aware matching logic and
  advisor review UX._

- **Cloud storage linking for imported documents** _(P3 E5 L3)_ — connect
  advisor's cloud storage (Google Drive, Dropbox, OneDrive) to persist uploaded
  source documents alongside extracted data. Enables audit trail, re-extraction
  with improved prompts, and advisor document management. _Why deferred:
  extraction works fine with in-memory processing; storage adds auth complexity
  (OAuth per provider) and infrastructure cost._

- **Plaid account linking** _(P3 E3 L5)_ — live balance + transaction feed
  for linked client accounts. Operationally heavy (token storage, webhooks,
  reauth, dedup, per-item cost). _Why deferred: AI statement import gives
  most of the value at a fraction of the cost; revisit after that ships._

## Schema

- **Per-entity tax rate / election fields** _(P3 E8 L6)_ — needed before we
  can model non-grantor entity taxes with per-entity overrides (e.g., trust
  with a specific tax ID and rate election). Ship as part of the trust-taxes
  work. _Why deferred: enabler, not standalone feature._

- **Assumption library** _(P4 E6 L6)_ — reusable advisor- or firm-level
  presets for return, inflation, tax rates, life expectancy, etc. _Why
  deferred: current per-client assumptions are workable; revisit once CMAs
  land._ (Note: CMAs have shipped, so this is technically unblocked now.)

- **Deprecate `flat_federal_rate` column** _(P2 E8 L1)_ — after bracket mode
  has been proven in production for ~6 months and no active clients remain
  on flat mode, the `flat_federal_rate` column can be dropped from
  `plan_settings` and the flat-path shim in `src/engine/tax.ts` removed.
  _Why deferred: safety net while bracket mode matures._

## Tooling

- **React component testing setup (RTL)** _(P3 E5 L2)_ — the repo has vitest
  for pure-logic tests but no React Testing Library. The tax drill-down modal
  (and earlier UI work) is validated by manual smoke test only. Adding RTL
  would let us write component-level tests for modal interactions, table
  rendering, keyboard accessibility, etc. _Why deferred: manual smoke tests
  have caught all issues so far; setup overhead not justified per-feature._

- **Scheduled / automated migrations in CI** _(P2 E7 L5)_ — migrations are
  applied manually via `drizzle-kit migrate` against the Neon URL in
  `.env.local`. _Why deferred: single dev, single environment for now._
