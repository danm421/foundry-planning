# Future Work — Client Data

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
