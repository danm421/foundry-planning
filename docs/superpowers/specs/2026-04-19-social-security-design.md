# Social Security Benefit Modeling — Design Spec

**Date:** 2026-04-19
**Branch:** `social-security`
**Scope:** Tier 1 (FRA + claim-age math) + Tier 2 (spousal + survivor benefits)

## Background

The app currently models Social Security as a single `Income` row with
`type: "social_security"`, an `annualAmount`, and an integer `claimingAge`.
The benefit is deferred until `birthYear + claimingAge` and grown forward
by the row's `growthRate`. Taxability follows IRS Pub 915 correctly
([`ssTaxability.ts`](../../../src/lib/tax/ssTaxability.ts)).

The app does not model FRA, early-retirement reduction, delayed-retirement
credit, spousal benefits, or survivor benefits. Advisors must manually
pre-compute the adjusted dollar amount using an external calculator before
entering it. This is the top source of user error in SS modeling and is
especially fragile for survivor scenarios, where the math diverges from the
claimant's own record.

Reference material (kept in `docs/private/`, gitignored):

- `Social Security in eMoney (1).docx` — canonical spec for how eMoney/Fidelity
  implements SS. Drives the math in this design.
- `Social Security technical quesitons and answers for Audit.docx` — Fidelity
  Audit Committee Q&A clarifying edge cases.
- `SS Tax Calc (2).xlsx` — Pub 915 taxability worksheet. Already implemented.

This design draws directly from those documents; section references below
(e.g. `§5.3.1`) point into the eMoney doc.

## Scope

### In scope (Tier 1 + Tier 2)

- **Tier 1 — FRA + claim-age math**
  - FRA table by birth year (1937+, with the January-1 rule)
  - Early-retirement reduction: 5/9% per month (first 36 mo) + 5/12%/mo thereafter
  - Delayed Retirement Credit: 2/3%/month, capped at age 70
  - Year+month claim-age precision (integer years in the form; engine treats
    claim age as `claimingAge*12 + claimingAgeMonths` months)
  - Monthly PIA input (matches the user's SSA statement)
  - A new `ssBenefitMode` discriminator on SS income rows:
    - `manual_amount` (legacy): existing behavior; user enters the pre-adjusted annual dollar amount
    - `pia_at_fra` (new): user enters monthly PIA; engine derives the annual benefit from FRA + claim age

- **Tier 2 — Spousal + survivor benefits**
  - Auto-max spousal benefit: each spouse receives `max(own, 50% × other's PIA)`
    with proper top-up decomposition (§5.4.2). Activates only when both spouses
    are in `pia_at_fra` mode and both have claimed.
  - Early spousal reduction: 25/36%/mo (first 36 mo) + 5/12%/mo thereafter (§5.3.4);
    no DRC on spousal (§5.3.2 note).
  - Survivor benefit on spouse's death, triggered by the existing
    `ClientInfo.lifeExpectancy` / `spouseLifeExpectancy` fields.
  - Full four-case survivor math from §5.6.5 (deceased filed early / at-FRA /
    before-never-filed / after-never-filed) including the 82.5%-of-PIA floor
    for case A and accrued-DRC-through-death for case D.
  - Survivor-FRA table (§5.6.2) — distinct from retirement FRA, with per-row
    monthly reduction percentages (max 28.5% total, i.e. 71.5% of max at age 60).
  - Survivor benefit eligibility independent of own `claimingAge`: survivor
    can start at age 60 even if their own claim age is later.
  - Cashflow-report SS drill-down showing per-spouse Retirement / Spousal /
    Survivor breakdown, matching eMoney's report structure (§4.2.2).

### Out of scope (see FUTURE_WORK.md)

| Tier | Capability | Why deferred |
|------|------------|--------------|
| 3 | "Help Me Compare" claim-strategy UI (62 vs FRA vs 70) | Bigger UI lift; Tier 1 alone makes today's SS modeling dramatically better |
| 4 | "Estimated From Income" — PIA from wage history (AIME, bend points, 35 highest years) | Needs annual SSA data + wage-history input UI; substantial project |
| 5 | Exempt Pension / WEP (blocks both benefit AND FICA) | Edge case; not yet requested |
| 5 | Max Family Benefit cap (175% of PIA) | Only matters for survivor + multiple children |
| 5 | Split-claim timing ("take survivor now, delay own to 70") | eMoney itself doesn't support it; engine will pay `max(own-at-claim, survivor)` per year |
| 5 | Surviving-child / disabled-worker child benefits | Low demand |
| 5 | Divorced-spouse benefits | Low demand |
| — | Per-scenario death-year overrides | Will live in the future Scenarios feature, not here |

## Data Model

### TypeScript `Income` type ([src/engine/types.ts](../../../src/engine/types.ts))

Three new optional fields on `Income`. All are meaningful only when
`type === "social_security"`; unset on all other income types.

```ts
export interface Income {
  // ... existing fields ...

  /** SS-specific. When unset, defaults to "manual_amount" (legacy behavior). */
  ssBenefitMode?: "manual_amount" | "pia_at_fra";

  /** SS-specific. Monthly PIA in today's dollars. Required when ssBenefitMode=pia_at_fra. */
  piaMonthly?: number;

  /** Additional months beyond `claimingAge` (0–11). Present or absent, the
   *  engine treats absent as 0. So claimingAge=66, claimingAgeMonths=4 means
   *  "66 years 4 months". */
  claimingAgeMonths?: number;
}
```

`claimingAge` (integer years) stays as-is. The additive `claimingAgeMonths`
field means existing rows continue to behave identically (claim at `N`
years, 0 months).

### DB schema ([src/db/schema.ts](../../../src/db/schema.ts))

Three new nullable columns on `incomes` via a new drizzle migration:

- `ss_benefit_mode` (text, nullable)
- `pia_monthly` (numeric, nullable)
- `claiming_age_months` (integer, nullable, default 0)

Existing rows get NULL / 0. Engine treats `ss_benefit_mode IS NULL` as
`manual_amount`. **No data migration required.**

### `ProjectionYear` additions ([src/engine/types.ts](../../../src/engine/types.ts))

One new optional field, populated only in years where at least one SS
income row is in `pia_at_fra` mode:

```ts
export interface ProjectionYear {
  // ... existing fields ...

  /** Present when at least one SS income in pia_at_fra mode was active
   *  this year. Annual dollar amounts. Populated by the orchestrator. */
  socialSecurityDetail?: {
    client:  { retirement: number; spousal: number; survivor: number };
    spouse?: { retirement: number; spousal: number; survivor: number };
  };
}
```

The top-level `income.socialSecurity` total continues to work as today —
the detail field is purely additive for the cashflow drill-down.

## Engine Architecture

### New module: `src/engine/socialSecurity/`

One new subdirectory, seven files total:

```
src/engine/socialSecurity/
  constants.ts          # FRA table, survivor-FRA table, reduction/DRC factors
  fra.ts                # fraForBirthYear, survivorFraForBirthYear
  ownRetirement.ts      # computeOwnBenefit(pia, claimAge, fra) → monthly
  spousal.ts            # computeSpousalBenefit(otherPia, claimAge, fra) → monthly
  survivor.ts           # computeSurvivorBenefit(deceasedRecord, survivor, year) → monthly
  orchestrator.ts       # resolveAnnualBenefit(row, spouseRow, client, year)
  __tests__/
    fra.test.ts
    ownRetirement.test.ts
    spousal.test.ts
    survivor.test.ts
    orchestrator.test.ts
```

Each module is a pure function (no IO, no mutation). The orchestrator is
the only module that knows about household state (other spouse's income
row, client DOB, life-expectancy-derived death year).

### Integration with existing engine

`src/engine/income.ts` is modified minimally. Inside the existing
`inc.type === "social_security"` branch, **before** the existing
`amount = ...` calculation, add:

```ts
if (inc.ssBenefitMode === "pia_at_fra") {
  const resolved = resolveAnnualBenefit(inc, spouseIncome, client, year);
  result.socialSecurity += resolved.total;
  result.bySource[inc.id] = resolved.total;
  // accumulate into ProjectionYear.socialSecurityDetail at caller level
  continue;
}
// Existing manual_amount code path untouched below this point
```

`manual_amount` rows flow through the existing code unchanged. Rows with
`ssBenefitMode === undefined` are treated as `manual_amount` — this is
what gives existing data byte-identical behavior.

The orchestrator requires access to the **other** spouse's SS row when
computing spousal / survivor benefits. `income.ts` already iterates a
flat `incomes` array, so a pre-pass finds the spouse's SS row by
`owner !== currentRow.owner && type === "social_security"`. If the
lookup misses (single client, or spouse has no SS row), spousal/survivor
math degrades gracefully to own-retirement-only.

## Math Rules

### FRA by birth year (§5.3.1)

Static table encoded as constants. A person born January 1 uses the
previous year's FRA (§5.3.1 note).

| Birth year | FRA |
|------------|-----|
| ≤ 1937 | 65y 0m |
| 1938 | 65y 2m |
| 1939 | 65y 4m |
| 1940 | 65y 6m |
| 1941 | 65y 8m |
| 1942 | 65y 10m |
| 1943–1954 | 66y 0m |
| 1955 | 66y 2m |
| 1956 | 66y 4m |
| 1957 | 66y 6m |
| 1958 | 66y 8m |
| 1959 | 66y 10m |
| ≥ 1960 | 67y 0m |

### Own-retirement benefit

Let `monthsOffset = claimAgeMonths − fraMonths` (positive = delayed, negative = early).

- `monthsOffset == 0`: `monthly = PIA`
- `monthsOffset < 0` (early, min −60 i.e. claim-62 with FRA-67):
  Let `m = |monthsOffset|`. Reduction =
  `min(m, 36) × 5/9% + max(m − 36, 0) × 5/12%`. Benefit = `PIA × (1 − reduction)`.
- `monthsOffset > 0` (delayed, capped at 70):
  Let `m = min(monthsOffset, 840 − fraMonths)`  (840 = age 70 in months).
  Credit = `m × 2/3%`. Benefit = `PIA × (1 + credit)`.

Ground-truth checkpoints:
- Claim-62 / FRA-67 → PIA × 0.70
- Claim-62 / FRA-66 → PIA × 0.75
- Claim-70 / FRA-67 → PIA × 1.24
- Claim-70 / FRA-66 → PIA × 1.32

### Spousal benefit

Requires **the other spouse to have reached their own claim age** (§5.1.2:
"entitled worker … has already filed").

```
if !otherSpouseHasClaimedYet:  return 0
base = otherPIA × 0.5
monthsOffset = claimAgeMonths − fraMonths
if monthsOffset >= 0:  return base    # no DRC on spousal (§5.3.2 note)
# Early-spousal reduction
m = |monthsOffset|
reduction = min(m, 36) × 25/36% + max(m − 36, 0) × 5/12%
return base × (1 − reduction)
```

Checkpoint: claim-62 / FRA-67 → base × 0.65.

### Top-up decomposition (§5.4.2)

When own and spousal are both non-zero, the total benefit is the larger
of the two, with a retirement-first / spousal-remainder breakdown:

```
if own >= spousal:
    total = own
    retirementPortion = own
    spousalPortion = 0
else:
    total = spousal
    retirementPortion = own
    spousalPortion = spousal − own
```

This decomposition matters for the cashflow drill-down. It also matters
because each portion is computed with its own reduction factor before
being summed — the math never double-reduces.

### Survivor benefit (§5.6.5)

Four cases for the **maximum** survivor benefit, depending on what the
deceased had done before death:

| Case | Condition | Max survivor benefit |
|------|-----------|----------------------|
| A | Deceased filed BEFORE FRA | `max(deceased's reduced benefit, 82.5% × deceased PIA)` |
| B | Deceased filed AT OR AFTER FRA | Deceased's benefit (incl. any DRC earned) |
| C | Deceased died BEFORE FRA and never filed | 100% × deceased PIA |
| D | Deceased died AT/AFTER FRA and never filed | `deceased PIA × (1 + monthsPastFRA × 2/3%)`, capped at age 70 |

Then apply the early-survivor reduction using the **survivor's own
survivor-FRA table row** if the survivor is claiming before their
survivor FRA:

```
if survivorAgeMonths >= survivorFraMonths:
    return maxSurvivor
m = survivorFraMonths − survivorAgeMonths
# Each survivor-FRA row precomputes monthlyReductionPct = 28.5% / monthsBetween60AndFra
reductionPct = m × survivorRow.monthlyReductionPct
return maxSurvivor × (1 − reductionPct)
```

Checkpoint: survivor at age 60 with survivor-FRA 66 → `maxSurvivor × 0.715`.

### Survivor-FRA table (§5.6.2)

| Birth year | Survivor FRA | Months 60→FRA | Monthly reduction pct |
|------------|--------------|---------------|-----------------------|
| 1939 | 65y 0m | 60 | 0.475% |
| 1940 | 65y 2m | 62 | 0.460% |
| 1941 | 65y 4m | 64 | 0.445% |
| 1942 | 65y 6m | 66 | 0.432% |
| 1943 | 65y 8m | 68 | 0.419% |
| 1944 | 65y 10m | 70 | 0.407% |
| 1945–1956 | 66y 0m | 72 | 0.396% |
| 1957 | 66y 2m | 74 | 0.385% |
| 1958 | 66y 4m | 76 | 0.375% |
| 1959 | 66y 6m | 78 | 0.365% |
| 1960 | 66y 8m | 80 | 0.356% |
| 1961 | 66y 10m | 82 | 0.348% |
| ≥ 1962 | 67y 0m | 84 | 0.339% |

The monthly reduction pct is precomputed and stored in the constant table —
it is always `0.285 / monthsBetween60AndFra`.

## Orchestrator Logic

Per year, per spouse:

```
ageThisYear = year − birthYearFromDob
claimAgeMonthsThisSpouse = claimingAge*12 + (claimingAgeMonths ?? 0)
hasClaimed = ageThisYear*12 >= claimAgeMonthsThisSpouse

otherSpouseDead =
  otherSpouseBirthYear != null &&
  year > otherSpouseBirthYear + otherSpouseLifeExpectancy

# --- Case 1: other spouse is dead (or no spouse) ---
if otherSpouseDead:
    if ageThisYear < 60:  return ZERO   # survivor eligibility begins at 60
    survivorAgeMonths = min(ageThisYear*12, survivorFraMonths)  # no DRC on survivor
    survivor = computeSurvivorBenefit(deceasedRecord, survivorAgeMonths, ...)
    own = hasClaimed ? computeOwnBenefit(thisSpousePia, ...) : 0
    # Same top-up pattern as spousal: larger wins, with retirement-first breakdown
    if own >= survivor:
        total, retPortion, survPortion = own, own, 0
    else:
        total, retPortion, survPortion = survivor, own, survivor − own
    return annualize({ retirement: retPortion, spousal: 0, survivor: survPortion, total }, yearlyGrowthFactor)

# --- Case 2: other spouse alive and has claimed ---
if !hasClaimed:  return ZERO
if otherSpouseHasClaimed:
    own = computeOwnBenefit(thisSpousePia, ...)
    spousal = computeSpousalBenefit(otherSpousePia, ...)
    total, retPortion, spouPortion = topUp(own, spousal)
    return annualize({ retirement: retPortion, spousal: spouPortion, survivor: 0, total }, yearlyGrowthFactor)

# --- Case 3: this spouse has claimed, other hasn't (and is alive) ---
return annualize({ retirement: computeOwnBenefit(...), spousal: 0, survivor: 0, total: retirement }, yearlyGrowthFactor)
```

`annualize` multiplies by 12 and applies the row's growth factor:
`(1 + growthRate) ^ (year − inflationStartYear)`. This keeps PIA's
today's-dollars semantics consistent with the rest of the app.

### A few important edge behaviors

- **Same-year death:** If the other spouse dies the same year the survivor
  would have first claimed, they get survivor for that year (not spousal).
  The `otherSpouseDead` branch fires before the alive-and-claimed branch.

- **Survivor age below 60:** returns 0. This deviates slightly from eMoney
  (§8.1.1 notes their system also limits survivor to age 62 — listed as a
  known gap) but matches SSA reality.

- **Deceased-never-filed, survivor past 62:** Case C or D math. `claimingAge`
  of the deceased is used to mean "they intended to claim at this age but
  died first", so "filed or not" is determined by `deceasedDeathAge <
  deceasedClaimAge`.

- **Manual_amount mode under survivor transition:** If the deceased had
  `manual_amount` mode, no PIA is stored, so the survivor transition has
  no record to fall back on. In that case the survivor simply gets nothing
  from the deceased's row (which stopped paying at death anyway). An advisor
  who wants to model survivor benefits must put both spouses in
  `pia_at_fra` mode. This is a documented limitation, not a silent bug.

## UI Changes

### Income edit form

Changes apply only when `type === "social_security"`. For all other income
types, the form is unchanged.

1. **Mode radio selector** (default: preserve existing value; new rows
   default to `pia_at_fra`):
   - "Enter annual benefit amount" → `manual_amount`
   - "Enter Primary Insurance Amount (PIA)" → `pia_at_fra`

2. **Conditional inputs by mode:**
   - `manual_amount`: existing `annualAmount` input + existing integer
     `claimingAge` field (unchanged)
   - `pia_at_fra`: new `piaMonthly` input with helper text
     "From your SSA statement — monthly benefit at FRA" + a claim-age
     picker with year (62–70) + months (0–11) fields

3. **Derived displays** (read-only, shown in both modes once DOB is known):
   - "Full Retirement Age: 66y 4mo (born 1956)"
   - In `pia_at_fra` mode only: a live preview of the computed first-year
     annual benefit, so the advisor can sanity-check against the SSA letter.
     Formula: `piaMonthly × 12 × reductionOrDrcFactor × (1+growthRate)^yearsToClaim`.

4. **Unchanged fields:** `growthRate`, `inflationStartYear`, `endYear`,
   `owner`, `startYear`, `cashAccountId`. The growth-rate and
   inflation-start-year fields apply to the PIA the same way they apply
   to the annualAmount today.

### Cashflow report drill-down

([`src/components/cashflow-report.tsx`](../../../src/components/cashflow-report.tsx))

Top-level "Social Security" row unchanged — still shows combined annual
total. New behavior: when at least one year in the range has
`socialSecurityDetail`, the row becomes expandable. Expanded view shows a
per-spouse sub-table matching eMoney's §4.2.2 layout:

| Year | Age | Client Retirement | Client Spousal | Client Survivor | Spouse Retirement | Spouse Spousal | Spouse Survivor | Total |

When only `manual_amount` rows are active (existing clients), there is no
expand affordance — the row behaves identically to today.

A dedicated "SS Report" tab with this layout full-page (eMoney §4) is
Tier 3 / FUTURE_WORK. The drill-down is sufficient for v1 of this feature.

## Testing Strategy

Tests use vitest (existing pattern).

### Unit tests — pure functions

**`fra.test.ts`**
- All 13 FRA-table rows and boundary years (1937, 1938, 1960)
- Jan-1 edge case (1960 Jan 1 → FRA = 66y 10m, matching 1959)
- Pre-1937 defaults to 65y 0m
- Same for survivor FRA table

**`ownRetirement.test.ts`** — SSA-published checkpoints as ground truth:
- Claim-62 / FRA-67 → PIA × 0.70
- Claim-62 / FRA-66 → PIA × 0.75
- Claim-67 / FRA-67 → PIA × 1.0
- Claim-70 / FRA-67 → PIA × 1.24
- Claim-70 / FRA-66 → PIA × 1.32
- Fractional: claim-66y6m / FRA-67 → PIA × (1 − 6 × 5/9%) = PIA × 0.9667
- Boundary: claim > 70 caps at claim-70 benefit (no additional DRC)

**`spousal.test.ts`** — verbatim examples from §5.4.2:
- "Combined Basic": Bob PIA $2000, Jan PIA $300, Jan@FRA → $1000 total =
  $300 retirement + $700 spousal
- "Larger Retirement": spousal $1000, own $1200 → $1200 all retirement,
  $0 spousal
- "Combined Reduced": spousal reduced to $900, own reduced to $400 →
  $900 total = $400 + $500
- "DRC Larger": own $1100 (DRC'd), spousal $1000 → $1100 all retirement
- "Early Split" (§5.3.5.1): 50 months early, Bob PIA $2000, Jan PIA $300 —
  retirement portion $300 × (1 − 36 × 5/9% − 14 × 5/12%), spousal portion
  $700 × (1 − 36 × 25/36% − 14 × 5/12%)
- Gate: other spouse hasn't claimed → spousal returns 0

**`survivor.test.ts`** — all four §5.6.5 cases:
- Case A: deceased filed at 62 with FRA 67, PIA 2000 → reduced benefit
  1400, floor `0.825 × 2000 = 1650` → survivor max = 1650
- Case B: deceased filed at 70 with FRA 67, PIA 2000 → survivor max
  = 2000 × 1.24 = 2480
- Case C: deceased dies at 55 (never filed), PIA 2000 → survivor max = 2000
- Case D: deceased dies at 68 (never filed), FRA 67, PIA 2000 →
  survivor max = 2000 × (1 + 12 × 2/3%) = 2160
- Early-survivor reduction: survivor claims at 60 with survivor-FRA 66 →
  `maxSurvivor × 0.715`
- Survivor at survivor-FRA exactly → no reduction

**`orchestrator.test.ts`** — integration-style unit tests:
- Both alive, both claimed, own > spousal → full own, spousal = 0
- Both alive, both claimed, own < spousal → own + spousal top-up
- Both alive, spouse hasn't claimed yet → own only, no spousal
- One dead, survivor 62, claimAge 67 → survivor only
- One dead, survivor past own claim age → max(own, survivor) with
  retirement-first decomposition
- One dead, survivor age 58 → zero
- Death and own-claim in same year → survivor wins (death takes
  precedence in the branch order)
- Growth-rate / inflation-start-year indexing applied correctly over
  multiple years

### Integration tests

([`src/engine/__tests__/projection.test.ts`](../../../src/engine/__tests__/projection.test.ts), extend)

- **Regression:** existing SS fixtures with no `ssBenefitMode` produce
  byte-identical output. Proves zero behavior change for current data.
- **Golden case:** household with both spouses in `pia_at_fra`, spouse
  dies at `lifeExpectancy` age 90, survivor lives to 95. Verify
  `socialSecurityDetail` across the transition year and all subsequent
  years.
- **Tax interaction:** verify `calcTaxableSocialSecurity` receives the
  correct combined gross (retirement + spousal + survivor) × 12 regardless
  of mode. The total must exactly match `socialSecurityDetail.client.*` +
  `spouse.*` summed, for any given year.

### Coverage target

~6 new test files, ~80–100 cases. Every math rule in this doc maps to
at least one test case.

## Migration

Existing data:
- `ss_benefit_mode IS NULL` → behaves as `manual_amount` (existing
  behavior)
- `pia_monthly IS NULL`, `claiming_age_months` default 0 → no effect on
  `manual_amount` rows

New drizzle migration `NNNN_social_security_fields.sql` adds the three
nullable columns. No data backfill required. The migration is forward-only;
a down migration is trivially just the column drops.

Default mode for newly created SS rows in the UI: `pia_at_fra`. This nudges
advisors toward the math-correct path for new work without disrupting existing
data.

## Deferred Work

All out-of-scope items listed in the Scope section are recorded in
[`docs/FUTURE_WORK.md`](../../FUTURE_WORK.md) with pointer back to this
spec. Two entries are updated:

- The existing "SS claiming optimizer" line is renamed to **Tier 3** and
  upgraded with references to this spec's groundwork.
- New **Tier 4** (PIA from wage history) and **Tier 5** (Exempt Pension /
  WEP, Max Family Benefit, child benefits, divorced-spouse benefits)
  entries are added with enough detail that a future session can pick
  them up.

See `FUTURE_WORK.md` for P / E / L scores.
