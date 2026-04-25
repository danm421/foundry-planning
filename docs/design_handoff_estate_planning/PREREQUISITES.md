# Estate Planning Report — Prerequisites

Gap analysis between the design in this folder (`Estate Planning v2.html`,
`Estate Planning v1 (other states).html`) and the current state of the
`foundry-planning` codebase.

**Last reconciled:** 2026-04-25. Reflects everything through life-
insurance follow-ups (premium retirement-cap + dead enum cleanup) and
the Hard Blocker 2 stale-bullet correction (no UI exemption-cap
hardcodes shipped — was design-mockup copy only).

Cross-referenced files:
- Engine: [src/engine/](../../src/engine/) — projection, tax,
  asset-transactions, `death-event/` (first-death, final-death,
  estate-tax, creditor-payoff, shared), types
- Estate tax lib: [src/lib/tax/estate.ts](../../src/lib/tax/estate.ts) —
  unified rate schedule, BEA
- Schema: [src/db/schema.ts](../../src/db/schema.ts)
- Deferred work: [~/Documents/foundry-finance/future-work/estate.md](../../Documents/foundry-finance/future-work/estate.md)

---

## Status summary

| # | Item                                                     | Status            | Shipped as                                                                                      |
|---|----------------------------------------------------------|-------------------|-------------------------------------------------------------------------------------------------|
| 1 | Family members as owners + beneficiary model             | ✅ Shipped 2026-04-20 | Spec "Estate Planning — Item 1"                                                              |
| 2 | Trust sub-type + irrevocability + exemption-consumed     | ✅ Shipped 2026-04-20 | Trust data-model spec                                                                         |
| 3 | Gift transaction primitive + exemption ledger            | ✅ Shipped 2026-04-20 | Gift ledger spec                                                                              |
| 4 | Death-sequence event (first → survivor, second → heirs)  | ✅ Shipped 2026-04-21 … 2026-04-24 | Specs 4a (wills) · 4b (first death) · 4c (final death) · 4d-1 (estate tax engine) · 4d-2 (Form-706 report UI) · 4e (liability bequests) |
| 5 | Federal estate tax + DSUE/portability + flat state rate  | ✅ Shipped 2026-04-23 | Spec 4d-1 — folded into the Item-4 chain                                                      |
| 6 | Step-up in basis at death                                | ✅ Shipped 2026-04-24 | Spec 6 — step-up at death                                                                |
| 7 | Life-insurance primitives (face/cash value, ILIT)        | ✅ Shipped 2026-04-25 | Spec "Life-insurance primitives" — face/cash split, §2042 inclusion, ILIT payout routing, term expiry, premium cash flow, Insurance panel |
| 8 | Scenario switcher / with-plan vs without-plan            | ⏸ Deferred post-v1 | Tracked in [future-work/ui.md](../../../Documents/foundry-finance/future-work/ui.md) ("Scenario switcher + side-panel editor") — not in estate-report v1 |
| 9 | UI: flowchart canvas, projection panel, Sankey           | ❌ Not shipped    | No drag-and-drop canvas, year scrubber, or Sankey anywhere in `src/components/`                |

---

## Hard blockers — the report cannot ship without these

### 1. Estate-tax engine — ✅ shipped (Spec 4d-1)

Federal 40% graduated schedule, applicable-exclusion math, DSUE
portability between spouses, flat-rate state estate tax, grantor-trust
succession, and creditor-payoff all live in
[src/engine/death-event/estate-tax.ts](../../src/engine/death-event/estate-tax.ts)
and
[src/lib/tax/estate.ts](../../src/lib/tax/estate.ts). `beaForYear`
returns `BEA_2026 = $15M` and inflates forward from there.

**Still outstanding** (tracked in `future-work/estate.md`):

- **Per-state estate-tax brackets** — only a flat rate
  (`flatStateEstateRate` on `plan_settings`) today. MA $2M cliff,
  NY/CT/OR brackets, etc., not modeled. The design references a
  "~12% effective CT rate" — the flat placeholder is sufficient for a
  CT demo but advisors in high-bracket states will need real brackets.
- **§2035 3-year add-back / gift tax paid** —
  `lifetimeGiftTaxAdjustment` reserved but hardcoded to 0.
- **GST tax + GST exemption tracking** — not modeled. SLAT remainder
  cards in the design don't flag GST, but any technical review will.
- **First-death tax-shortfall recovery** — emits
  `estate_tax_insufficient_liquid` warning, but no IRS lien / §6324
  modeling.
- **Retirement-beneficiary ordinary-income tax pass** — emits
  `retirement_estate_drain` warning; no tax computed.

### 2. Gift-tax / exemption-usage ledger — ✅ shipped (Item 3)

Gift ledger + per-grantor `lifetime_exemption_used` rollup implemented.
Trust-card footer value ("Uses exemption $X / $Y") is computable from
engine output when the estate-report UI is built.

The "UI hardcodes `LIFETIME_EXEMPTION_CAP` / `annualExclusionAmount`"
note that previously sat here was **stale** — those constants existed
only as design-mockup copy in `Estate Planning v2.html` ($13.99M
predates OBBBA; 2026 BEA = $15M); they were never shipped to the
actual UI. The shipped code reads BEA from
[src/lib/tax/estate.ts:35-45](../../src/lib/tax/estate.ts#L35-L45) and
the annual exclusion from `tax_year_parameters` via
[`resolveAnnualExclusion`](../../src/lib/gifts/resolve-annual-exclusion.ts).
The gift dialog and trust form do not display either value as a "cap"
today — that copy lands when the estate-report UI builds the
trust-card footer.

### 3. Step-up in basis at death — ✅ shipped (Spec 6)

`computeSteppedUpBasis` in
[src/engine/death-event/shared.ts](../../src/engine/death-event/shared.ts)
resets in-estate asset basis to date-of-death FMV inside the
`effectiveAcct` build of the first-/final-death chains and inside
`runPourOut`'s per-account loop. Category gate: `retirement` and
`life_insurance` are excluded (IRD rule under §1014(c)).
JTWROS accounts at first death receive a half step-up.

**Still outstanding** (tracked in `future-work/estate.md`):

- **Community-property double step-up** — common-law JTWROS only.
  States AZ, CA, ID, LA, NV, NM, TX, WA, WI get full step-up on the
  survivor's half too. Requires a state flag on `plan_settings`.
- **§2040(a) non-spouse JTWROS consideration-furnished rule** —
  engine assumes spousal JTWROS (50/50).
- **§1014(e) 1-year rule** on gifted-then-inherited-back assets.
- **§754 partnership inside-basis elections.**

### 4. Death-sequence projection — ✅ shipped (Specs 4a–4e)

`runProjection` fires `applyFirstDeath` / `applyFinalDeath` at the
correct ages; wills, beneficiary designations, titling, fallback, and
liability bequests all flow through the death-event precedence chain.

### 5. Trust data model — ✅ shipped (Item 2)

`entities` now carries `entity_type`, `entity_sub_type` (Revocable,
Irrevocable, ILIT, SLAT, CRT, GRAT, IDGT, etc.), `is_irrevocable`,
`grantor` (`client`|`spouse`), `exemption_consumed`, trustee and
remainder-beneficiary fields. Legacy `entities.beneficiaries` JSON
is still read for backwards compatibility (drop-column follow-up in
future-work).

### 6. Life insurance / ILIT primitives — ✅ shipped (Spec "Life-insurance primitives")

Shipped 2026-04-25. New `life_insurance_policies` (1:1 with the
`life_insurance` account) + `life_insurance_cash_value_schedule`
tables (migration 0049). Face-value / cash-value split, policy-type
enum (`term` / `whole` / `universal` / `variable`), insured enum
(`client` / `spouse` / `joint`), term-end derivation, and
`endsAtInsuredRetirement` flag all modeled. Engine: `death-event`
now runs a Phase 0 `prepareLifeInsurancePayouts` that routes face
value through beneficiary designations (ILIT-owned policies go OOE;
client/spouse-owned default to estate unless bene-designations
override). §2042 gross-estate inclusion on client-owned policies.
Term policies drop to zero at term end (no payout on later death).
Premium cash flow synthesized into the expenses stream (basic mode
or free-form cash-value schedule). UI: new Details → Insurance tab
with grouped list + tabbed policy dialog (Details / Beneficiaries /
Cash-Value Growth w/ CSV upload). Term policies hidden from Net
Worth; permanent policies read-only with deep-link back to the
Insurance panel. Timeline detector emits `insurance:term_expired`
at `endYear + 1`.

**Follow-up engine gaps cleared 2026-04-25:**
- ✅ `synthesizePremiumExpenses` now caps the billing horizon at the
  insured's retirement year when `endsAtInsuredRetirement` is set
  (was latent — explicit `premiumYears` could outlive retirement).
- ✅ Unused `life_insurance_payout` transfer `via` enum value deleted.

The remaining open §2042 corner (merge-target attribution under
`postPayoutMergeAccountId`) is logged in
[future-work/engine.md](../../../Documents/foundry-finance/future-work/engine.md).

### 7. Family members as owners / beneficiaries — ✅ shipped (Item 1)

`external_beneficiaries` + `beneficiary_designations` tables,
`accounts.owner_family_member_id`, and per-account/trust beneficiary
editing all live. Per-account beneficiaries UI shipped 2026-04-24.

### 8. Joint-asset allocation step — ⚠️ partial

**Engine:** `applyTitling` consumes joint accounts at first death —
deceased's half passes to survivor automatically (Step 1 of the
precedence chain). No engine blocker for today's report.

**UX in the new canvas design:** joint assets render with a `⇋` lock
affordance and are *not draggable* until the advisor runs an
allocation step. No equivalent UI exists today — joint is modeled as
a single `owner === "joint"` row, and there is no drag-canvas to move
it into or out of. This is a **UI prerequisite** for the flowchart
tab, not a data-model gap.

---

## Soft blockers — report will look wrong without these

### 9. Scenario switcher / "with plan" vs "without plan" — ⏸ deferred post-v1

Scoped out of estate-report v1 (2026-04-24). The three-column
comparison and dual-line growth chart require a scenario-diff layer
that isn't being built for v1 — the estate report will ship
single-scenario. Tracked in
[~/Documents/foundry-finance/future-work/ui.md](../../../Documents/foundry-finance/future-work/ui.md)
("Scenario switcher + side-panel editor"). The with/without-plan
comparison is an additive layer that can land later without
rework to the single-scenario report.

### 10. Non-grantor trust income tax — ❌ not shipped

Irrevocable-trust earnings are projected tax-free. SLAT remainder
growth projected 40 years is meaningfully wrong without trust /
compressed-bracket income tax. Tracked in
`future-work/estate.md` (IDGT income-tax treatment post-grantor-flip
and non-grantor trust generally).

### 11. GST tax & generation-skipping exemption — ❌ not shipped

Design doesn't show GST explicitly, but SLATs to grandchildren
trigger it. See Hard Blocker 1's outstanding list.

### 12. Exemption sunset assumption — ✅ obsolete

**No action needed.** The design's "Exemption sunset 2026" chip is
stale copy. OBBBA (2025) made the TCJA-expanded amount permanent and
set BEA 2026 = $15M, indexed for inflation. See
[src/lib/tax/estate.ts:35-45](../../src/lib/tax/estate.ts#L35-L45).
**Action:** replace the "Exemption sunset 2026" chip with an
"Exemption $15M / person (OBBBA)" assumption chip when the UI is
rebuilt.

### 13. Per-scenario death-year overrides — ❌ not shipped

Engine uses `lifeExpectancy` from `plan_settings`. Advisors need to
scrub death years to explore sequences (the spine's "TODAY · 2026 →
FIRST DEATH · 2048 → SECOND DEATH · 2054" model). Tracked as
future-work.

---

## Nice-to-haves — do not block v1

- IRMAA tiers, trust/estate brackets wiring, state bracket tax —
  precision, not correctness-of-concept.
- Multi-year scheduled gifting (annual-exclusion strategies).
- QPRT / GRAT specific mechanics (retained interest, remainder
  valuation).
- CRT / charitable vehicles beyond a beneficiary tag.

---

## UI prerequisites (only after data/engine gaps close)

The `Estate Planning v2.html` flowchart tab needs these UI primitives
that don't exist in the codebase today:

1. **Three-column drag-and-drop canvas.** No drag canvas in
   `src/components/`. Pick `@dnd-kit/core` (already used by the
   priority-list reorder in `clients/[id]/open-items/`) and extend.
2. **Death-sequence spine component.** Vertical flow: timeline tick
   → pair row → stage bands (tax, inherit, heirs) → beneficiary strip
   → totals. All new.
3. **Year-scrubber projection panel.** Full-width `<input
   type="range">` overlay, event pins at key years, preset buttons
   (`Today`, `+10y`, `1st death`, `2nd death`, `+40y`), teal glow.
4. **Three-column comparison grid.** Without-plan · with-plan · delta.
   Shares tokens with the client-dashboard design system (JetBrains
   Mono tabular-nums, `§.NN` markers) — coordinate with the
   `token-foundation` build.
5. **Growth chart (dual series).** 1200×220 SVG via Recharts/Visx
   (already in repo for timeline). Area gradients, dashed death-year
   guides, current-year marker with dual dots.
6. **Strategy impact cards.** ILIT payout, SLAT compounded growth,
   "if you wait 10 years" cost-of-procrastination.
7. **Create-Trust side-over** (from v1 reference).
8. **Impact & Beneficiaries Sankey** (v1 reference). No Sankey
   library in repo — pick `@visx/sankey` or `d3-sankey` when the tab
   is built.
9. **Assumptions modal / chip bar** — growthRate, inflationRate,
   death1Year, death2Year, exemptionPerPerson. Per-scenario override
   UI overlaps with soft-blocker 13.

All nine UI pieces depend on the **token foundation** (merged
2026-04 — `MoneyText`, `SectionMarker`, `Card` family, and the
brand token system in `globals.css`) for colors, typography, spacing,
and the `MoneyText` / `§.NN` primitives.

---

## Suggested build order (updated)

Items 1–5 are **done**. Remaining path to the full
`design_handoff_estate_planning` report:

1. ✅ Family members as owners + beneficiary model.
2. ✅ Trust sub-type + irrevocability + exemption-consumed.
3. ✅ Gift transaction primitive + exemption ledger.
4. ✅ Death-sequence event (first death → survivor, second death →
   heirs).
5. ✅ Estate-tax calc: federal + portability/DSUE + flat state rate.
6. ✅ Step-up in basis at death.
7. **Life-insurance primitives (face vs cash value, ILIT death-
   benefit payout).** Medium: schema + death-event integration +
   seed data for ILIT demos. Required to light up the ILIT
   strategy card and populate the beneficiary strip with a death
   benefit.
8. ⏸ ~~Scenario switcher ("with plan" / "without plan")~~ —
   **deferred post-v1.** Estate report ships single-scenario.
   Tracked in `future-work/ui.md`.
9. **UI: flowchart canvas, projection panel, Sankey** — lands on
   top of the shipped data layer + token foundation. Sequence:
   canvas (9.1) → spine component (9.2) → scrubber + comparison
   (9.3) → growth chart (9.4) → strategy cards (9.5) → Create-
   Trust side-over (9.6) → Sankey tab (9.7) → Assumptions modal
   (9.8).

**Pre-launch polish** (not blocking v1):

- Per-state estate-tax brackets (MA/NY/CT/OR).
- GST tax modeling.
- Non-grantor-trust income tax pass.
- §2035 3-year add-back / gift tax paid.
- Per-scenario death-year overrides.
- Replace outdated "Exemption sunset 2026" copy with OBBBA chip.

The estimate-hiding mockup has aged well — items 6, 7, 8 are each a
real schema + engine project, and item 9 is a substantial UI build
on top. Realistic pre-launch estimate is still substantial, but
well-scoped now that the data chain is solid.
