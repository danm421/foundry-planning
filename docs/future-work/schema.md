# Future Work — Schema

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
