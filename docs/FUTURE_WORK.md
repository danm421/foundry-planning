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
backlog; two of them (per-entity tax fields, family members as owners) are
enablers and should ship folded into their parent feature.

| # | Item | P | E | L | Total |
|---|------|---|---|---|-------|
| 1 | CMAs + model portfolios | 7 | 5 | 9 | 21 |
| 2 | Robust tax engine (Excel-driven) | 8 | 3 | 9 | 20 |
| 3 | Scenario switcher + side panel | 9 | 2 | 8 | 19 |
| 4 | Assumption library | 4 | 6 | 6 | 16 |
| 5 | Monte Carlo / probability of success | 8 | 4 | 3 | 15 |
| 6 | Plan PDF export | 5 | 6 | 4 | 15 |
| 7 | SS claiming optimizer | 5 | 6 | 2 | 13 |
| 8 | Client-facing read-only view | 4 | 6 | 3 | 13 |
| 9 | Estate planning report | 7 | 2 | 3 | 12 |
| 10 | Plan vs actual tracking | 4 | 4 | 3 | 11 |
| 11 | Roth conversion optimizer | 5 | 3 | 3 | 11 |

Dependency notes that override raw score:

- Ship **CMAs before Monte Carlo** (MC depends on CMA data).
- Ship **per-entity tax fields with the tax engine** (enabler, P3/L6).
- Ship **family members as owners before estate report** (enabler, P3/L6).
- **Roth optimizer** is cheap only after the tax engine lands.
- **Plan vs actual** is cheap now that AI statement import has shipped.
- Start the **scenario switcher design doc** in parallel with #2/#3 — it's the
  biggest lift and benefits from early design pressure.

## UI

- **Scenario switcher + side-panel editor** _(P9 E2 L8)_ — schema supports
  multiple scenarios per client but the UI always operates on the base case.
  Target UX is a side panel that lets the advisor add/modify/remove data for a
  specific scenario with live recalculation and a diff vs base (including the
  portfolio assets chart on the cash-flow page). Open design question: overlay
  model (base changes propagate, scenario stores only deltas) vs copy model
  (scenario forks at creation). Leaning overlay with a "detach" action. _Why
  deferred: large effort; base case first._

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

- **Robust tax engine driven by uploadable tax-year data** _(P8 E3 L9)_ —
  replace hard-coded brackets/limits with a `tax_year_parameters` table
  seeded from an advisor-maintained Excel workbook (brackets, standard
  deduction, SS wage base, AMT, NIIT thresholds, IRMAA tiers, etc.). Engine
  layer then covers AMT, NIIT, QBI, capital-gains stacking, SS taxability,
  and state tax. Unlocks the Roth optimizer and non-grantor entity tax work.
  _Why deferred: two-phase effort (data model + upload pipeline, then engine
  work); current flat-rate approximation is acceptable for MVP._

- **Non-grantor entity-level taxes** _(P3 E5 L2)_ — when an entity is not
  flagged `is_grantor`, household taxes are correctly skipped but the entity
  itself owes tax on its income and RMDs. That tax isn't modeled; the
  entity's checking grows as if pre-tax. _Why deferred: depends on robust
  tax engine + per-entity tax rate fields._

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

- **Capital market assumptions (CMAs) + model portfolios** _(P7 E5 L9)_ —
  firm-level library of asset classes with expected return, mean, and
  standard deviation, composed into reusable model portfolios that can be
  attached to any client account. Prerequisite for Monte Carlo. _Why
  deferred: no data model yet; advisors currently set per-account return
  assumptions by hand._

- **Monte Carlo / probability of success** _(P8 E4 L3)_ — stochastic
  projection over N trials using CMA-driven portfolio returns; surface
  probability-of-success and percentile cones on the cash-flow chart. _Why
  deferred: depends on CMAs; current engine is deterministic._

- **Roth conversion optimizer** _(P5 E3 L3)_ — recommend annual conversion
  amounts that fill a target bracket across the plan horizon. _Why deferred:
  depends on robust tax engine._

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
  plan (balance sheet, cash flow, assumptions). Reportlab patterns from
  `ethos-tools` can be ported. _Why deferred: no advisor has asked for a
  polished export yet._

## Integrations

- ~~**AI statement import in Client Data**~~ — **SHIPPED.** Import tab in
  client-data with drag-and-drop upload, Azure OpenAI extraction for 6
  document types, step-by-step review wizard, and batch commit with
  `source: "extracted"`.

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
  can model non-grantor entity taxes. Ship as part of the robust tax engine
  work. _Why deferred: enabler, not standalone feature._

- **Assumption library** _(P4 E6 L6)_ — reusable advisor- or firm-level
  presets for return, inflation, tax rates, life expectancy, etc. _Why
  deferred: current per-client assumptions are workable; revisit once CMAs
  land._

## Tooling

- **Scheduled / automated migrations in CI** _(P2 E7 L5)_ — migrations are
  applied manually via `drizzle-kit migrate` against the Neon URL in
  `.env.local`. _Why deferred: single dev, single environment for now._
