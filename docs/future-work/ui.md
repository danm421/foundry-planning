# Future Work — UI

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

- **Net Cash Flow column masks portfolio depletion** _(P8 E7 L4)_ — the
  cashflow table's "Net Cash Flow" column ([cashflow-report.tsx:1000](../../src/components/cashflow-report.tsx#L1000))
  is colored `v < 0 ? red : green`, but the engine's supplemental withdrawal
  loop plugs shortfalls before this number is computed, so the column reads
  green ($0) even in years the household is bleeding 6-figure portfolio
  withdrawals. Verified live on Dan Sample: 51 of 55 years are
  zero/near-zero, only 1 negative. Advisors looking at the table cannot
  see plan stress. Suggested fix: rename the column to "Cash Filled From
  Portfolio" using `withdrawals.total` as the value, or color by
  withdrawal-rate-vs-portfolio threshold (yellow >4%, red >7%). _Why
  deferred: surfaced in the 2026-04-19 cashflow audit; not addressed in
  the engine-fix pass that landed the same day. Highest-impact UI gap
  remaining._
