# Estate Planning Report — Prerequisites

Gap analysis between the design in this folder (`Estate Planning v2.html`,
`Estate Planning v1 (other states).html`) and the current state of the
`foundry-planning` codebase.

Cross-referenced files:
- Engine: [src/engine/](../../src/engine/) — projection, tax, asset-transactions, types
- Tax lib: [src/lib/tax/](../../src/lib/tax/) — federal, capGains, amt, niit, state, fica, qbi
- Schema: [src/db/schema.ts](../../src/db/schema.ts)
- Deferred work: [docs/FUTURE_WORK.md](../FUTURE_WORK.md)

---

## Hard blockers — the report cannot ship without these

### 1. Estate-tax engine (does not exist)
- Federal estate tax calc: 40% over exemption, with **portability / DSUE** between spouses.
- Lifetime exemption tracking (~$13.99M/person in 2026).
- **2026 TCJA sunset** logic — exemption ~halves after sunset date (design shows "Exemption sunset 2026" as an assumption chip).
- **State estate tax** — design references a ~12% effective CT rate. We don't have per-state estate tax at all. FUTURE_WORK #21 notes even *income* state tax is still flat.
- The spine's "Taxes & Expenses" and "Inheritance" bands are the direct outputs of this engine.

### 2. Gift-tax / exemption-usage ledger
- Moving an asset into an irrevocable trust is a taxable gift that **uses lifetime exemption**.
- No gift transaction primitive exists.
- No running exemption-used ledger per grantor.
- Trust card footer ("Uses exemption $2.40M / $13.99M") requires this.

### 3. Step-up in basis at death
- In-estate assets get a step-up; irrevocable-trust assets do not. This is the *core lesson* the "with plan" vs "without plan" delta is teaching.
- [src/engine/asset-transactions.ts](../../src/engine/asset-transactions.ts) has no death-event hook for basis adjustment.

### 4. Death-sequence projection
- Engine has `lifeExpectancy` on [src/engine/types.ts](../../src/engine/types.ts) (line ~42) but it's only used to stop SS/income streams.
- No event model for:
  - First death → transfer to surviving spouse (unlimited marital deduction).
  - Second death → liquidation / estate tax / distribution to heirs.
- Entire center column (spine) depends on this.

### 5. Trust data model is too thin
- [src/db/schema.ts](../../src/db/schema.ts) has an `entities` table with `entityType` and freeform `beneficiaries` JSON.
- Missing:
  - Trust sub-type enum (`ILIT` / `SLAT` / `CRT` / `GRAT` / `Revocable` / `Irrevocable`).
  - Irrevocability flag driving in- vs out-of-estate classification.
  - Per-trust exemption consumed.
  - Trustee and remainder-beneficiary fields shown on the card.
- Today, revocable vs irrevocable is collapsed — anything OOE-tagged is treated out of estate.

### 6. Life insurance / ILIT primitives
- No concept of **face value vs cash value**.
- No death-benefit payout event.
- No ILIT-specific rule: face value enters heirs outside estate at death.
- Required for the "ILIT · $5M policy → +$5.00M at death2" strategy card.

### 7. Family members as owners / beneficiaries
- Already tracked in FUTURE_WORK ("Family members as owners", P3/E5/L6) as an explicit estate-report prerequisite.
- Today `family_members` rows are informational only — children/grandchildren can't own or be beneficiaries.
- Beneficiary strip (Tom Jr., Sarah, Stanford, SLAT remainder) and Impact & Beneficiaries Sankey are blocked on this.

### 8. Joint-asset allocation step
- Design requires joint assets to be locked (⇋) until an at-death allocation is assigned.
- We model joint ownership only as a percent split on the account — no at-death allocation rule.

---

## Soft blockers — report will look wrong without these

### 9. Scenario switcher / "with plan" vs "without plan"
- FUTURE_WORK #1 (P9). The three-column comparison and dual-line growth chart *are* a scenario diff UI.
- Needs the overlay/fork design already scoped.

### 10. Non-grantor trust income tax
- FUTURE_WORK #17 + trust/estate brackets #16.
- SLAT remainder growth projected 40 years is meaningfully wrong if income isn't taxed along the way.

### 11. GST tax & generation-skipping exemption
- Not modeled. SLATs often trigger GST considerations.
- Design doesn't show GST explicitly, but any serious review will flag its absence.

### 12. Exemption sunset assumption
- Engine has no mechanism for "2026 sunset halves exemption."
- Design shows this as an assumption chip and expects it to flow through projections.

### 13. Per-scenario death-year overrides
- FUTURE_WORK SS item (P4). Advisors will want to scrub death years independently of life expectancy to explore sequences.

---

## Nice-to-haves — do not block v1

- IRMAA tiers, trust/estate brackets wiring, state bracket tax (all already in FUTURE_WORK) — precision, not correctness-of-concept.
- Multi-year scheduled gifting (annual-exclusion strategies).
- QPRT / GRAT specific mechanics (retained interest, remainder valuation).
- CRT / charitable vehicles beyond a beneficiary tag.

---

## Suggested build order

1. Family members as owners + beneficiary model (enabler).
2. Trust sub-type + irrevocability flag + exemption-consumed field on `entities`.
3. Gift transaction primitive + exemption ledger.
4. Death-sequence event in projection engine (first death → survivor, second death → heirs).
5. Estate-tax calc: federal + portability/DSUE + flat state-estate-tax placeholder matching our flat-state-income-tax pattern.
6. Step-up in basis at death.
7. Life insurance primitives (face vs cash value, death benefit payout, ILIT classification).
8. Scenario switcher (shared with other report work — parallelize with 1–7).
9. Then the UI: flowchart canvas, projection panel, Sankey.

Items 1–7 are each a real schema + engine project. The polished mockup hides that — realistic pre-UI estimate is substantial.
