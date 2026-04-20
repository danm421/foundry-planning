# Future Work — Engine

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

- **SS: Estimated-from-income / PIA from wage history (Tier 4)** _(P4 E3 L3)_ —
  the Tier 1+2 work (spec at
  `docs/superpowers/specs/2026-04-19-social-security-design.md`) requires
  advisors to hand-enter each spouse's PIA from their SSA statement. Tier 4
  derives PIA automatically from a wage history, matching eMoney's
  "Estimated From Income" mode (§6 of the eMoney spec in `docs/private/`).
  **What's required:**
  (a) a new `ss_year_parameters` table (same pattern as the existing
  `tax_year_parameters`): per-year OASDI wage base, SSA Average Wage Index
  (historical + projected), PIA bend points;
  (b) annual data update process (SSA Trustees Report, November each year)
  mirroring the existing tax-table update flow;
  (c) a wage-history input UI on the client (or auto-derived from salary
  incomes plus a "highest salary earned" / "last year employed" override);
  (d) AIME calculator (cap wages, index to worker's Index Year = eligibility
  year − 2, select 35 highest years, divide by 420);
  (e) PIA calculator (90% × bend-point-1 + 32% × segment-2 + 14% ×
  segment-3);
  (f) a new `ssBenefitMode: "estimated_from_income"` enum value threading
  through the existing mode switch.
  **Where it plugs in:** the orchestrator in `src/engine/socialSecurity/`
  is ready to consume a PIA value regardless of source. Tier 4 is purely
  "compute PIA before handing it to the orchestrator."
  _Why deferred: biggest SS feature; unblocked by Tier 1+2 landing but
  substantial data + UI work. Advisors can work with PIA-from-statement
  in the meantime._

- **SS: Exempt Pension / Windfall Elimination Provision (Tier 5)** _(P3 E4 L2)_
  — adds a per-spouse "Exempt Pension" mode (§2.2.4 + §5.9 of the eMoney
  spec). Two coupled effects: (a) the worker receives no SS retirement
  benefit, and (b) they pay no Social Security portion of FICA (Medicare
  still applies). Their spouse also loses spousal benefits on their
  record. Needs a new `ssBenefitMode: "exempt_pension"` enum value and a
  plumbed flag on the `fica.ts` calculator to skip the SS portion when
  that mode is set. Phase-out WEP scenarios are explicitly not supported
  (eMoney also punts these). _Why deferred: edge case; primary use case
  is government employees with pensions. Advisor base doesn't currently
  include them. Spec builds naturally on Tier 1+2 data model._

- **SS: Max Family Benefit cap** _(P2 E6 L1)_ — caps total survivor +
  surviving-child benefits at 175% of the deceased's PIA (simplified
  version per eMoney §5.6.7; full MFB formula ranges 150–180% across
  three PIA tiers). Only matters when surviving-child benefits or
  multiple-beneficiary scenarios land (currently neither is modeled).
  _Why deferred: no downstream consumer yet — wait for surviving-child
  benefits (also Tier 5) to create demand._

- **SS: Surviving-child / child-of-retiree benefits** _(P2 E5 L1)_ — minor
  children of a deceased or retired worker are eligible for benefits
  (75% of PIA for disabled workers; see eMoney §8.1-8.2). Requires a
  model of household minors with DOBs. Full rules include school-age
  extensions (to 19 if still in school). Interacts with the Max Family
  Benefit cap. _Why deferred: no household-minors data model and no
  advisor asks._

- **SS: Divorced-spouse benefits** _(P2 E5 L1)_ — a divorced individual
  with a 10+-year marriage and no remarriage can claim spousal benefits
  on the ex-spouse's record (§8.3 of the eMoney spec). Requires data
  about ex-spouses (their PIA, or their wage history). _Why deferred: no
  ex-spouse data model and no advisor asks._

- **SS: Split-claim timing** _(P2 E5 L1)_ — lets a survivor take the
  survivor benefit at one age while delaying their own retirement to a
  different age (§5.7.3 of the eMoney spec — eMoney itself also punts
  this). Would require splitting the single `claimingAge` into separate
  `survivorClaimAge` and `ownClaimAge` fields per spouse. Tier 1+2 pays
  `max(own-at-claim, survivor)` per year, which handles the common case
  but misses the "delay own while taking survivor" optimization. _Why
  deferred: lower-frequency scenario; real benefit but needs a new data
  model wrinkle._

- **SS: Per-scenario death-year overrides** _(P4 E5 L3)_ — currently
  `lifeExpectancy` and `spouseLifeExpectancy` are single values on `ClientInfo`
  that apply to all scenarios. A scenario switcher (see item #1 in Suggested
  Order) should allow per-scenario overrides so advisors can model "what if
  spouse lives to 80 vs 90" without duplicating the whole plan. _Why deferred:
  depends on scenario switcher landing first; current single-LE model is
  correct and sufficient for Tier 1+2 SS feature._

- **SS: Mixed pia_at_fra + manual_amount in same household** _(P2 E6 L1)_ —
  when one spouse uses `pia_at_fra` mode and the other uses `manual_amount`,
  survivor math silently returns 0 because `deceasedPia = otherRow.piaMonthly ?? 0`
  and a `manual_amount` row has no `piaMonthly`. Unusual configuration
  (advisors using the SS feature are expected to use `pia_at_fra` for both
  spouses), but could confuse if a plan is partially migrated. _Why deferred:
  low-frequency edge case; no advisor has hit it yet._

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

- **State-level bracket tax** _(P6 E2 L4)_ — replace flat state rate with
  per-state progressive brackets. Needs a data-ingestion pipeline covering
  all 50 states + DC (bracket thresholds vary per state, update annually).
  Some states tax LTCG as ordinary (most), some have no state tax (FL, TX,
  etc.), some have local/city tax (NY, NYC). Big data project. _Why deferred:
  flat-rate approximation within ~1% of actual state tax for most clients
  is acceptable for planning-horizon work._ **Known accuracy gap**: flat
  approximation breaks down sharply for high-bracket states (CA, NY, NJ, MA,
  HI, OR) on clients with large taxable events — a $1M LTCG year for a CA
  resident using a 7% flat rate vs the actual 13.3% top marginal mis-states
  state tax by $63k. Until per-state brackets ship, the UI should not present
  state-tax numbers for those states as authoritative — tag the state tax
  column with a "flat-rate estimate" caveat in tax-detail views (new
  deferred sub-item below).

- **"Flat state-tax estimate" badge in tax-detail UI** _(P4 E8 L1)_ — small
  UI tag on the state-tax row/column indicating the engine is using the
  plan's flat state rate, not actual state brackets. Prevents advisors
  inadvertently showing clients a state-tax number that's off by 5-figures
  for high-tax-state residents with large events. Ships independently of
  the full per-state bracket project. _Why deferred: waiting for the
  cashflow-fixes branch to land before stacking another tax-detail UI
  change._

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

## From the 2026-04-19/20 cashflow accuracy audit

The fix pass at 74e946d / f5abaf2 / 08af937 closed 12 of 15 P0/P1
findings against live data. The items below are followups that were either
deliberately scoped out of that pass or surfaced during verification.

- **OBBBA SALT cap effective year + AGI phase-down** _(P5 E8 L2)_ —
  [derive-deductions.ts:25-27](../../src/lib/tax/derive-deductions.ts#L25-L27)
  uses `year >= 2026 ? 40_000 : 10_000`. Per Pub. L. No. 119-21 §70120
  (OBBBA), the $40k cap is effective tax year **2025+**, and phases down
  30% above $500k single / $600k MFJ AGI back toward the $10k floor by
  AGI ≈ $700k MFJ. Current code is off by one year for 2025 projections
  AND silently keeps $40k for very-high-income clients who'd see a
  meaningful phase-down. _Why deferred: cosmetic for 2026+ projections;
  matters for plans that include TY 2025 or HENRY clients._

- **Age 65+ additional standard deduction (and OBBBA senior bonus)**
  _(P6 E7 L3)_ — [derive-deductions.ts](../../src/lib/tax/derive-deductions.ts)
  doesn't apply the $1,550-MFJ-each / $1,950-single (2024 values)
  age-65+/blind additional standard deduction, and doesn't apply the OBBBA
  $6,000-per-filer 65+ "senior bonus" added 2025+. For a target audience
  of retirement-planning advisors this is a recurring miss: a 70/68 MFJ
  couple gets +$3,100 (pre-OBBBA) or +$15,100 (post-OBBBA) of additional
  std deduction not currently modeled — typically $700-$3,300 of tax per
  year. _Why deferred: requires age plumbing into deduction derivation;
  not in the SS/AMT/NIIT pass._

- **Roth 401(k) employer match — taxability post-2023** _(P5 E6 L2)_ —
  [projection.ts:1006-1029](../../src/engine/projection.ts#L1006-L1029)
  treats all employer match as tax-free regardless of destination. SECURE
  2.0 §604 made employer match to a Roth 401(k) **taxable to the employee
  in the year contributed**. Engine misses this for any savings rule with
  `employerMatchPct > 0` targeting a Roth 401(k) account. _Why deferred:
  uncommon today (most plans still match to traditional bucket) but
  growing._

- **IRA contribution-limit MAGI phase-outs** _(P5 E6 L3)_ —
  [contribution-limits.ts](../../src/engine/contribution-limits.ts) treats
  IRA limits as flat dollar caps. Reality:
  - Traditional IRA deductibility phases out by MAGI when covered by a
    workplace plan ($77k–$87k single, $123k–$143k MFJ for 2024)
  - Roth IRA contributions phase out by MAGI ($146k–$161k single,
    $230k–$240k MFJ for 2024)
  Engine models high earners as making full Roth contributions when
  legally barred. _Why deferred: most clients with this issue should be
  using backdoor Roth, which we don't model either._

- **Property-tax inflation start year for mid-projection asset purchases**
  _(P3 E8 L1)_ — [projection.ts:374-385](../../src/engine/projection.ts#L374-L385)
  inflates synthetic property tax from `planSettings.planStartYear` for
  every account, including accounts created mid-projection by an asset
  purchase technique. So a property bought in 2035 with $10k of tax (in
  user-entered dollars) shows ~$13.04k in its first year because of 9
  years of compounded inflation from 2026. Either inflate from
  acquisition year (correct for "expressed in year-of-purchase dollars")
  or document the convention so users know to enter today's dollars.
  _Why deferred: rare; only matters when users add asset-purchase
  techniques._

- **Realization OI → `interestIncome` lumping for NIIT** _(P3 E5 L2)_ —
  [projection.ts:901](../../src/engine/projection.ts#L901) feeds **all**
  ordinary-income realization (cash + taxable buckets) into the tax
  engine's `interestIncome` field. The asset-class realization split's
  OI bucket on a brokerage account can include interest, non-qualified
  dividends, REIT distributions, and royalties — most of which ARE
  NIIT-qualifying anyway, so the result is materially correct, but the
  labeling is loose and would mis-classify if any future asset class
  routed pension/annuity income through the OI bucket (NIIT-exempt). Fix:
  split realization OI into per-source sub-categories. _Why deferred:
  current behavior is conservative (slight over-inclusion in NIIT) and
  fixing it requires extending the realization split schema._

- **SECA tax not surfaced in `taxResult.flow.fica` field** _(P2 E9 L1)_ —
  [projection.ts](../../src/engine/projection.ts) mutates
  `taxResult.flow.totalTax += secaResult.seTax` after `calculateTaxYear`
  returns, but `taxResult.flow.fica` still shows only the W-2 employee
  share. UI tax-detail rows that show "FICA" won't include SECA, so
  advisors looking at a self-employed client's tax-detail breakdown will
  see a mismatch between the FICA row and the bottom-line total. Fix:
  add a separate `seca` field on `flow` and either show it as its own row
  or fold into a "Payroll/SE Tax" combined row. _Why deferred: the
  totals are right; only the per-line UI display is off._

- **Silent clamp in `Math.max(0, ordinaryIncome - interestIncomeForTax)`**
  _(P1 E10 L1)_ — [projection.ts](../../src/engine/projection.ts) clamps
  `ordinaryIncome - interestIncomeForTax` at 0. If a future code path
  ever makes `interestIncomeForTax > taxDetail.ordinaryIncome` (probably
  impossible given current build order), the engine silently truncates
  without flagging. Add a `console.warn` in dev mode (or assertion in
  test mode) to catch regressions. _Why deferred: defensive; not a
  current-day bug._
