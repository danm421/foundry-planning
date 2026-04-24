# Estate-planning deferred work

Items consciously scoped out of the estate-planning build. Delete the bullet
when the item ships. Promote to `FUTURE_WORK.md` (main index) if any of these
start getting upvoted across sessions.

## Beneficiary designations (item 1 — shipped 2026-04-20)

- **Migrate legacy `entities.beneficiaries` JSON → `beneficiary_designations`
  rows.** Why deferred: belongs to Estate Planning item 2 (trust data model)
  consolidation work; the free-form JSON is still read for backwards
  compatibility.
- **Charity metadata (EIN, address) on `external_beneficiaries`.** Why
  deferred: no consumer yet; add when a report actually needs it.
- **DB-level `SUM(percentage) = 100` enforcement on designations.** Why
  deferred: API + helper validation is sufficient for v1; a deferred trigger
  is noisy to maintain and not needed until direct DB imports land.
- **Polymorphic unified-owner column on `accounts`.** Why deferred:
  backwards-incompatible refactor; additive `owner_family_member_id` column
  chosen instead.

## Trust data model (item 2 — shipped 2026-04-20)

- **Drop legacy `entities.beneficiaries` JSON column.** Why deferred: engine
  still consumes it as the shipping read path; drop after item 4 wires the
  `beneficiary_designations` consumption end-to-end.
- **Migrate `entities.exemption_consumed` opening balance into the gift
  ledger.** Why deferred: advisor-entered balance is still the authoritative
  starting point; gift ledger takes over once item 4 threads exemption math
  through engine rules.

## Gift ledger (item 3 — shipped 2026-04-20)

- **Source `LIFETIME_EXEMPTION_CAP` and `annualExclusionAmount` from
  `tax_year_parameters` in the UI.** Why deferred: UI currently hardcodes
  `LIFETIME_EXEMPTION_CAP = 13_990_000` and `annualExclusionAmount = 19_000`.
  Move to DB-sourced values once item 5 (estate-tax engine) wires
  cap-with-sunset.
- **GST exemption tracking.** Why deferred: advisor typically doesn't model
  skip-person gifting in v1; add if/when item 5 adds generation-skipping
  transfer tax.

## Wills

- **Legal will document generation** — the platform models a will as structured
  bequest data for projection purposes only. It does not generate a
  signable legal document, capture executor / witness / notarization details,
  or track the physical document's storage location. Why deferred: the
  planning projection cares about *where assets flow*, not about
  document-management or e-signing. That's its own product surface.
- **Non-account specific bequests** — today's model expresses bequests only as
  allocations of tracked accounts. Advisors cannot model "my art collection to
  my niece," "my Tesla to my son," or any tangible personal property the
  platform doesn't otherwise track. Why deferred: the platform has no
  first-class "personal property" primitive; adding one is its own schema +
  valuation project.
- **Behavioral / time-based conditions** — "if they reach age 30," "so long as
  they are married," "contingent on completing rehab." The v1 `condition`
  field covers only spouse-survivorship; richer per-beneficiary conditions are
  out of scope. Why deferred: v1 resolves every bequest at the grantor's death
  deterministically; modeling behavioral conditions requires per-year state
  machines per beneficiary.
- **Multiple wills / codicils** — the model assumes one will per grantor. No
  versioning of the legal document, no dated amendments. Why deferred:
  advisors model the *current effective* will; version history belongs to the
  document-management layer, not the projection engine.
- **Disclaimer / QTIP / credit-shelter bifurcation** — bequests that flow
  into a sub-trust created at death (bypass-trust patterns). Why deferred:
  the bypass-trust primitive itself isn't modeled yet; add once trust
  creation-at-death is in scope.
- **Multi-asset bequests in a single clause** — each bequest today names one
  asset (or "all other assets"). If an advisor wants "my brokerage AND my IRA
  to child A," they create two bequests. Why deferred: one-asset-per-clause
  matches the UX popup model and keeps validation simple. Compound clauses
  are purely an advisor-time-saving convenience.
- **Intestate defaults** — if no will is configured for a grantor, the engine
  should refuse to run a second death (or surface a warning). No
  state-specific intestate succession rules. Why deferred: all clients in
  scope have a will; modeling 50 states of intestate succession is low-value.

## First-death asset transfer

- **Beneficiary-designation override per account at first death** — today the
  rules are fixed (titling → bene-designation → will). No advisor-facing "skip
  bene-designation for this account at first death" escape hatch. Why
  deferred: we don't have a compelling case for the override yet; if it comes
  up, add a per-designation `suppressAtFirstDeath: boolean`.
- **Auto-conversion of revocable trust to irrevocable at grantor death** —
  realistic (grantor-death typically locks the trust), but the engine
  currently leaves the `isIrrevocable` flag unchanged. Advisor must toggle
  manually if they care. Why deferred: compounds with trustee-succession
  rules we also don't model.

### After 4b ship (2026-04-21)

- **External-beneficiary label resolution in the transfer ledger** — the
  projection loop currently passes `externalBeneficiaries: []` to
  `applyFirstDeath`, so ledger entries for external recipients carry the
  fallback label "External beneficiary" instead of the actual name. Extend
  the projection-data loader to include external beneficiaries and pass them
  through. Why deferred: ledger correctness (ids, percentages, and amounts)
  is all intact; only the display label is missing, and no UI surface
  consumes the label yet.
- **Inherited-IRA RMD mechanics (SECURE Act 10-year rule)** — retirement
  accounts willed to non-spouse recipients are treated as normal accounts
  with the new owner. Real inherited-IRAs follow a 10-year distribution rule
  with no further contributions. Add when the first report actually needs
  the distinction.
- **Qualifying-surviving-spouse 2-year MFJ extension** — the IRS allows a
  widow(er) with a dependent child to file MFJ for two additional years
  after the death year. `effectiveFilingStatus` flips to single at year+1
  regardless. Add when advisor demand surfaces.
- **Beneficiary-designation contingent-tier logic** — primaries only in v1.
  If a primary predeceases the deceased, the contingent tier should receive
  their share. Add when contingent designations land in the UI.
- **Fallback tier-2 deceased-child filtering** — the fallback chain
  currently treats every child as living (no `dateOfDeath` field on
  `family_members`). When child mortality modeling is added, filter out
  deceased children from the even-split denominator and emit
  `fallback_children_recipient_deceased` warnings.
- **Widow(er) Social Security survivor benefit** — when a deceased spouse is
  claiming SS, the survivor is typically entitled to the greater of their
  own benefit or a survivor benefit based on the deceased's record.
  `applyIncomeTermination` currently clips the deceased's SS income at
  death year with no survivor-benefit uplift on the survivor's own SS
  income. Domain-correctness gap; add when the SS-modeling surface is
  revisited.
- **Liability-schedule rollforward for death-event-created liabilities** —
  when a linked mortgage is split proportionally across two recipients at
  death, the two resulting `death-liab-N` liabilities inherit
  balance/payment but don't have entries in the pre-loop
  `liabilitySchedules` map. `projection.ts` falls back to `liab.balance` for
  the remaining years, so amortization post-split may not roll forward
  correctly (interest accrues but principal doesn't amortize from the
  schedule). Why deferred: no current test exercises a multi-year mortgage
  rollforward after a split, and the household-level cash-flow still
  reflects the right monthly payment. Fix when the first integration test
  for cross-year post-split mortgage amortization is added.
- **Orphan `owner === "joint"` invariant** — the orchestrator's
  `assertInvariants` rejects lingering `owner === deceased` but not
  `owner === "joint"`. Today `applyTitling` always consumes joint accounts,
  so this can't leak, but the invariant is incomplete as defense-in-depth.
  Add the `owner === "joint"` check when the next refactor touches this
  function.
- **Dangling `linkedPropertyId` audit** — if a liability has a
  `linkedPropertyId` that doesn't appear in the accounts list, the
  death-event silently passes it through. Harmless today but would mask a
  data-integrity issue; worth surfacing as a warning at projection-data
  load time.
- **Eliminate `Account.value` inside the engine** — `Account.value` is the
  starting fixture balance, but year-over-year growth updates only
  `accountBalances[id]`, leaving `workingAccounts[i].value` stale for the
  whole projection. Task 14 fixed the death-event symptom by plumbing the
  current balance into `effectiveAcct`, but the root-cause risk class
  remains: any future engine pass that reads `Account.value` mid-loop will
  silently use stale data. The right structural fix is to split the type
  (e.g., `AccountDefinition` with `initialValue` for DB/UI boundaries vs.
  an engine-internal `Account` with no value field, driven entirely by
  `accountBalances` + `basisMap`). Larger refactor; not blocking for 4b
  but worth surfacing before 4c/4d land.

## API routes

- **`verifyCrossRefs` TOCTOU under concurrent deletes** — the wills POST/PATCH
  and the beneficiary-designations PUT both read cross-reference rows
  (accounts, family members, external beneficiaries, entities) *outside* the
  insert transaction. A concurrent DELETE of a referenced row between the
  check and the insert would leak a dangling FK violation to the user as a
  500 rather than a clean 400. Not worth fixing per-route; the real fix is
  either (1) a DB-level deferred constraint check, or (2) re-running
  verifyCrossRefs inside the transaction. Why deferred: pre-existing pattern
  across several routes; batch-fix in a dedicated pass.

## Loaders

- **Wills loader duplication (now at 3 consumers)** — the three-query
  Map-folding loader (wills → bequests → recipients) lives in three files:
  `src/app/api/clients/[id]/projection-data/route.ts` (engine shape, no
  recipient id), `src/app/api/clients/[id]/wills/route.ts` GET (API shape,
  early return), and `src/app/(app)/clients/[id]/client-data/wills/page.tsx`
  (page shape). The three-consumer trigger has fired; extraction into
  `src/lib/wills/load-wills.ts` with a generic `includeRecipientId` flag is
  now actionable tech debt rather than deferred. Why not done in the same
  session: requires plan-level scope that wasn't budgeted alongside UI work.
  Next session touching any wills loader should do this extraction first.

## Wills panel

- **Concurrent duplicate-will POST returns 500 instead of 409** — the
  `POST /api/clients/[id]/wills` duplicate-grantor guard does a SELECT
  then INSERT. Two simultaneous posts for the same (client, grantor) can
  race past the SELECT; the second hits the unique index and surfaces as
  a 500. Catch Postgres error code `23505` and map to 409. Operationally
  low-risk for a single-advisor tool but a real correctness gap.
- **Drag-to-reorder** — the spec called for drag-to-reorder via a ⋮⋮
  handle. The implementation ships ↑/↓ buttons for accessibility and
  simplicity. Swap in a DnD library (react-dnd / @dnd-kit) if advisor
  feedback prefers drag.
- **Engine-input snapshot test** — the spec listed a dedicated
  DB → `ClientData.wills` end-to-end snapshot test under the
  `projection-data` route. Not delivered; coverage relies on the tenant
  tests + tsc. Add when spec 4b's first engine consumer lands.
- **Under-allocation warning** — the WillsPanel banner currently flags
  only over-allocation (`sum > 100.01` on a specific-asset / condition
  group). Under-allocation (e.g., 50% of an account bequeathed, other 50%
  unaccounted for) silently falls to intestacy for the remainder. Add a
  second warning tier once over-allocation handling is validated in
  production. Why deferred: over-allocation is the more common data-entry
  error; under-allocation often reflects intentional residual disposition
  that the advisor will cover with an all-assets bequest.

## Zod schema DRY-up

- **Shared `uuidSchema` in `src/lib/schemas/common.ts`** — the custom-regex
  `uuidSchema` is now duplicated across `gifts.ts`, `beneficiaries.ts`, and
  `wills.ts`. The regex works around Zod v4's strict `.uuid()` rejecting
  sequential test UUIDs. Every new schema file that uses a UUID will repeat
  the 2-line block unless we export it once from `common.ts` and update the
  three existing files. Why deferred: cross-cutting cleanup touching three
  schemas is outside the wills scope; bundle with the next schema addition
  or do as a standalone consolidation PR.

## Trust / entity

- **Per-entity portfolio-inclusion override** — `includeInPortfolio` was
  dropped in spec 4b in favor of deriving rollup from `isIrrevocable`. If
  advisors want to show an irrevocable trust rolled up for a particular
  narrative (or hide a revocable trust), we'd re-introduce a per-entity
  override. Why deferred: no advisor has asked; `isIrrevocable` is the right
  default truth.

## Account ownership

- **Fractional lifetime ownership of accounts** — today `Account.owner` is
  `"client" | "spouse" | "joint"` and joint is the only way to express a
  split. Advisors with clients who own e.g. 25% of a business, a
  tenants-in-common real-estate stake, or a minority LLC interest have to
  model it as "enter the account value equal to the client's share" —
  crude but produces correct household totals. A real fix would introduce
  a principal-ownership percentage (or a `principals: [{who, pct}]`
  array) and propagate through the account form, balance sheet,
  investments report, engine owner checks, RMD pro-rating, and
  tax-realization code. Why deferred: orthogonal to the 4b death-event
  split mechanic (lifetime-fraction and at-death-split compose cleanly
  if both exist), and the blast radius is its own multi-spec project.
  Revisit after 4b–4d + estate-tax engine ship and we know whether the
  crude workaround has bitten the advisor workflow.

### After 4c ship (2026-04-23)

- **Spec 4e — liability bequest overrides** — extend the will schema to
  let advisors route specific debts to specific heirs (complements 4c's
  proportional-default distribution). Needs DB migration + API updates +
  wills UI panel changes + a new pre-proportional step in 4b / 4c. A
  full-stack sibling to 4a; scheduled after 4d (estate tax).
- **`ExternalBeneficiarySummary` loader for 4c** — same follow-up as 4b;
  the projection loop still passes `externalBeneficiaries: []` to
  `applyFinalDeath`, so any external recipient in the 4c chain gets the
  fallback "External beneficiary" label. Extend `projection-data/route.ts`.
- **Creditor-payoff at final death (supersedes Feature A)** — the more
  realistic model: liquidate liquid assets to pay unlinked debts before
  distributing the residual estate. 4c's proportional-to-heirs default
  is honest-but-not-realistic; reality is creditors-before-heirs. 4d
  (estate tax) is the natural home for the payoff step since it also
  wants "debts of decedent" as an estate-tax deduction.
- **Post-truncation heir rollforward** — 4c hard-stops the projection;
  heirs who received accounts at 4c don't roll forward in the same
  projection. When the multi-generational report ships, each heir gets
  their own sub-projection seeded from the 4c ledger.
