# Future Work — Reports

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

- **Combined-mode donut inner-ring tooltip labels** _(P2 E3 L2)_ — the
  nested donut shares a single `labels` array across both datasets (set to
  outer-ring class names). When the user hovers an inner-ring type arc,
  Chart.js 4.x resolves `labels[i]` from the outer array, so tooltips on
  the inner ring show the wrong name once the number of classes exceeds
  the number of types. The legend below the donut is always correct.
  _Why deferred: a proper fix requires per-dataset label callbacks or a
  different chart-library approach; scope out of asset-type-groups._

- **DB `CHECK` constraint on `asset_classes.asset_type`** _(P2 E3 L2)_ —
  the column is `varchar(32)` with app-level validation only (`isAssetTypeId`
  on POST/PUT). Direct SQL or future ad-hoc migrations could introduce
  values outside the five-member union, which would then render as blank
  color swatches in the UI. A one-line `CHECK` would guarantee the domain
  at the DB layer. _Why deferred: defense-in-depth, not correctness —
  app-level validation covers all supported write paths._

- **Allowlist mutable fields on `PUT /api/cma/asset-classes/[id]`**
  _(P3 E4 L3)_ — the current handler spreads the raw request body into
  Drizzle's `.set()`, which means any schema column (including `firmId`,
  `id`, `createdAt`) could be overwritten by a crafted request. The
  `WHERE firmId = ...` clause prevents cross-firm reads, but a caller
  could corrupt ownership of a record it already has access to. Harden
  by explicitly allowlisting mutable fields. _Why deferred: existing
  behavior predates the asset-type-groups branch and the exploitability
  is low; worth a defense-in-depth fix in a follow-up task._
