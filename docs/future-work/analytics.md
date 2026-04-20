# Future Work — Analytics

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

- **Social Security claiming optimizer (Tier 3)** _(P5 E6 L2)_ — "Help Me
  Compare" style UI showing cumulative lifetime benefit at 62 / FRA / 70
  for each spouse, with break-even-age annotations against the
  spouse's life expectancy. Matches eMoney's "Help Me Compared" dialog
  (§3 of `docs/private/Social Security in eMoney (1).docx`).
  _Why deferred: unblocked by Tier 1+2 (spec at
  `docs/superpowers/specs/2026-04-19-social-security-design.md`). Once
  that ships, the math exists — this is pure UI work to surface it.
  **Implementation notes for future session:** take the PIAs from each
  spouse's `pia_at_fra` income row, call `orchestrator.resolveAnnualBenefit`
  for each year of each candidate claim age (62/FRA/70/current), sum
  through each spouse's life expectancy, and render as a small-multiples
  chart plus a table of break-even years. No new data model is required;
  the existing `Income` row plus the Tier 1+2 math module is sufficient._
