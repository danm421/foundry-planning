# Estate Planning — Spec 4d: Estate Tax, Grantor-Trust Succession, and Creditor-Payoff

**Date:** 2026-04-23
**Scope:** The engine event that computes federal and state estate tax at each
death, handles grantor-trust succession (revocable-trust pour-out, IDGT
grantor-flip), liquidates liquid accounts to extinguish unlinked decedent
debts (creditor-payoff) and to pay estate tax, and emits a structured
`EstateTaxResult` breakdown per death year. Federal math uses the Form 706
unified rate schedule with simplified portability (DSUE auto-ports 100% of
the first decedent's unused exemption to the survivor).
**Chain:** 4a (wills data) → 4b (first-death transfer) → 4c (final-death transfer) → **4d (estate tax + grantor-trust succession + creditor-payoff)** → 4e (liability bequests).
**Packaging:** single spec, two implementation plans — **Plan 4d-1** ships
the engine, data model, and Assumptions-form changes (data-only end-to-end);
**Plan 4d-2** consumes that data in a full Estate Tax report page.

## Goal

When either death event fires in a projection, produce engine state that
reflects real-world estate settlement:

- Trust entities whose grantor just died transition correctly: revocable
  trusts flip to irrevocable and pour out to trust beneficiaries;
  irrevocable grantor trusts (IDGTs) flip their income-tax grantor
  status but continue as standing entities.
- Unlinked decedent debts (credit cards, unsecured loans) are paid from
  the estate's liquid assets in a fixed category order before heirs
  receive their residuals. Remaining debt falls back to 4c's
  proportional-to-heirs mechanic only when the liquid pool is exhausted.
- Federal estate tax is computed at each death using the Form 706 unified
  rate schedule, with simplified portability that auto-ports unused BEA
  (Basic Exclusion Amount) from first decedent to survivor as DSUE
  (Deceased Spousal Unused Exclusion).
- State estate tax is a flat-rate multiplier on the taxable estate,
  configurable per client via the Assumptions tax-rates form.
- Estate tax is physically paid from the decedent's liquid accounts in
  the same category order as creditor-payoff. At first death, the
  drain is restricted to the decedent's individual residuary — the
  marital share is not tapped.
- A full `EstateTaxResult` breakdown attaches to each death year's
  `ProjectionYear`, with every line needed for plan 4d-2's report page.

## Non-goals

- **Full Estate Tax report page** — Plan 4d-2. Spec 4d-1 ships the
  structured data shape and the engine that produces it; report UI is
  the next plan on top.
- **Gift tax actually paid / §2035 3-year add-back** —
  `lifetimeGiftTaxAdjustment` is a reserved line hardcoded to `0` in v1.
  Clients who gifted in excess of BEA during lifetime will be
  slightly over-taxed relative to Form 706; documented limitation.
- **Per-state estate-tax exemptions / brackets** — MA's $2M cliff, NY's
  graduated brackets, OR's exemption — all out. Flat rate × taxable
  estate only. Advisors approximate effective state liability by
  tuning the flat rate.
- **Generation-skipping transfer tax** — carried from gift-ledger future-work.
- **Inherited-IRA SECURE Act 10-year rule** — carried from 4b future-work;
  retirement accounts inherited by non-spouse recipients are still
  modeled as normal accounts under the new owner.
- **IDGT income-tax treatment post-flip** — flipping `isGrantor: false`
  at grantor death is wired; the downstream income-tax pass that
  computes trust-level tax under compressed brackets is its own future
  spec. 4d-1 surfaces the flag change via an `idgt_grantor_flipped`
  warning.
- **`Account.value` staleness refactor** — carried from 4b/4c
  follow-ups; still out of scope.
- **Multi-grantor trust support** — v1 enforces one grantor per trust
  via DB check + UI single-select. Joint-revocable grantor trusts are
  not modeled; advisors who need this pattern track the trust as two
  separate single-grantor entities. If a client structure ever needs
  split-grantor modeling, it is an additive change to the schema and
  succession helper.
- **Qualifying-surviving-spouse 2-year MFJ extension** — carried from 4b.
- **Beneficiary-designation contingent tier** — carried from 4b.
- **Disclaimer / QTIP / credit-shelter bifurcation** — carried.
- **Full report-page UX** — see plan 4d-2.

All future-work deferrals are tracked in
[docs/future-work/estate.md](../../future-work/estate.md).

## Terminology

All federal estate-tax terms are IRS/IRC statutory — not copied from any
third-party planning platform:

| Term | Meaning |
|---|---|
| Gross Estate | Sum of FMV of all includible assets minus includible decedent debts, per IRC §§2031–2046 |
| Taxable Estate | Gross Estate minus marital, charitable, and administrative deductions |
| Adjusted Taxable Gifts | Sum of post-1976 lifetime taxable gifts (IRC §2001(b)(1)(B)) |
| Tentative Tax Base | Taxable Estate + Adjusted Taxable Gifts + Lifetime Gift Tax Adjustment |
| Tentative Tax | Unified Rate Schedule applied to Tentative Tax Base (IRC §2001(c)) |
| Applicable Exclusion | BEA + DSUE — total exemption available at death |
| Unified Credit | Unified Rate Schedule applied to Applicable Exclusion |
| Federal Estate Tax | `max(0, Tentative Tax − Unified Credit)` |
| BEA | Basic Exclusion Amount (IRC §2010(c)(3)) — $15M in 2026, indexed going forward |
| DSUE | Deceased Spousal Unused Exclusion — first decedent's unused BEA, ported to survivor |
| Portability | The statutory mechanism (IRC §2010(c)(5)) by which unused BEA passes to the survivor |

`lifetimeGiftTaxAdjustment` is a reserved field for the Form 706 line 7
offset ("gift tax paid or payable on post-1976 gifts at current rates");
always `0` in v1.

## Pipeline shape

Two new phases sandwich the existing 4b/4c precedence chain at each death.

### At first death

1. **4b precedence chain** (existing) — produces asset transfer ledger
2. **Grantor-trust succession** (new) — revocable-trust flip for decedent-grantor trusts; IDGT grantor-flip; pour-out queued for single-grantor revocables that just became irrevocable
3. **Gross estate computation** (new) — builds `grossEstateLines[]` from post-4b-chain balances using Section "Gross estate rules" below
4. **Deduction stack** (new) — marital (from 4b ledger), charitable (from ledger filtered by `external_beneficiary.kind === 'charity'`), admin expenses (from plan settings)
5. **Federal tax** (new) — Form 706 formula with `BEA(year)` + `dsueReceived = 0`
6. **State tax** (new) — `flatStateEstateRate × taxableEstate`
7. **DSUE derivation** (new) — `max(0, applicableExclusion − tentativeTaxBase)`, stashed in projection state for the final-death event
8. **Estate-tax payment** (new) — `drainLiquidAssets()` on decedent's individual residuary only (not marital share)
9. **`applyIncomeTermination`** (existing)
10. Emit `EstateTaxResult` onto the first-death year's `ProjectionYear`

### At final death

1. **Grantor-trust succession** (new) — final-grantor flip for any still-revocable entities; trust pour-outs queued
2. **Gross estate computation** (new) — pre-drain balances, no 50/50 joint (4b already retitled)
3. **Creditor-payoff drain** (new) — `drainLiquidAssets()` extinguishes unlinked decedent debt. Residual falls to existing `distributeUnlinkedLiabilities` helper.
4. **Deduction stack** (new) — charitable, admin (no marital)
5. **Federal tax** (new) — Form 706 with `BEA(year)` + `dsueReceived` from stashed first-death value (0 for single-filer)
6. **State tax** (new)
7. **Estate-tax payment drain** (new) — same liquidation order
8. **4c precedence chain** (existing, repositioned) — runs on **post-drain** account balances; queued trust pour-outs are folded in as a preceding step before the will step
9. **`applyIncomeTermination`** (existing)
10. **Projection truncation** (existing)
11. Emit `EstateTaxResult` onto the final-death year's `ProjectionYear`

Key structural change: **at final death, 4c's precedence chain moves from
"runs first" to "runs last."** Creditor-payoff and estate-tax payment
both debit accounts before 4c allocates residuals to heirs. 4c's existing
proportional-to-heirs distribution becomes the fallback path for
creditor-payoff residual — fires only when liquid assets are insufficient.

## File layout

`src/engine/death-event.ts` (~1400 LOC post-4c) is split into a folder:

```
src/engine/death-event/
├── index.ts                  re-exports the public surface
├── shared.ts                 computeFirst/FinalDeathYear, identifyDeceased,
│                             precedence-step helpers, firesAtDeath, splitAccount,
│                             applyFallback, applyIncomeTermination,
│                             distributeUnlinkedLiabilities, invariant checks
├── first-death.ts            applyFirstDeath (with tax + grantor + drain phases)
├── final-death.ts            applyFinalDeath (with creditor-payoff + tax + pour-out)
├── estate-tax.ts             NEW — Form 706 formula, BEA(year), DSUE derivation,
│                             gross-estate builder, deduction-stack helper
├── grantor-succession.ts     NEW — revocable-flip, IDGT-flip, pour-out queue
└── creditor-payoff.ts        NEW — drainLiquidAssets helper (shared by debt
                              payoff and tax payment)
```

Plus `src/lib/tax/estate.ts` holding the `UNIFIED_RATE_SCHEDULE` constant,
`applyUnifiedRateSchedule(amount)`, and `beaForYear(year, taxInflationRate)`.

This split closes out the "monolithic death-event.ts" cleanup item flagged
in the 4c handoff.

## Data model

### DB migration (one additive migration)

```sql
ALTER TABLE plan_settings
  ADD COLUMN estate_admin_expenses     numeric(15, 2) NOT NULL DEFAULT '0',
  ADD COLUMN flat_state_estate_rate    numeric(5, 4)  NOT NULL DEFAULT '0';

-- Single-grantor-per-trust simplification
ALTER TABLE entities
  ADD COLUMN grantor owner_enum NULL;

-- Pre-production data fix-up: copy first grantor's name into the
-- single-grantor column, mapping name matches to 'client' / 'spouse'.
-- Any row with no discernible match stays NULL (third-party grantor).
UPDATE entities
  SET grantor = CASE
    WHEN jsonb_array_length(grantors) >= 1
         AND (grantors -> 0 ->> 'name') = (
           SELECT first_name FROM clients WHERE clients.id = entities.client_id
         ) THEN 'client'::owner_enum
    WHEN jsonb_array_length(grantors) >= 1
         AND (grantors -> 0 ->> 'name') = (
           SELECT spouse_name FROM clients WHERE clients.id = entities.client_id
         ) THEN 'spouse'::owner_enum
    ELSE NULL
  END;

ALTER TABLE entities DROP COLUMN grantors;
```

No changes to `tax_year_parameters`. BEA is computed via formula:

```ts
// src/lib/tax/estate.ts
export const BEA_2026 = 15_000_000;
export function beaForYear(year: number, taxInflationRate: number): number {
  if (year <= 2026) return BEA_2026;
  return BEA_2026 * Math.pow(1 + taxInflationRate, year - 2026);
}
```

One constant, one formula, no seeded DB table. OBBBA (2025) made TCJA's
expanded exemption permanent and set 2026 BEA to $15M indexed for
inflation — no sunset branch to maintain.

### Engine types

`src/engine/types.ts`:

```ts
export interface GrossEstateLine {
  label: string;                    // "INV - Client 401k" or "Home (50%)"
  accountId: string | null;         // null for liability lines
  liabilityId: string | null;
  percentage: number;               // 0.5 for joint at first death, else 1.0
  amount: number;                   // positive for assets, negative for debts
}

export interface EstateTaxResult {
  year: number;
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";

  // Gross Estate
  grossEstateLines: GrossEstateLine[];
  grossEstate: number;

  // Deductions
  estateAdminExpenses: number;
  maritalDeduction: number;         // 0 at final death
  charitableDeduction: number;
  // Debts already folded into grossEstateLines as negative entries.
  taxableEstate: number;

  // Tentative Tax Base
  adjustedTaxableGifts: number;
  lifetimeGiftTaxAdjustment: number; // 0 in v1; reserved
  tentativeTaxBase: number;

  // Federal Tax
  tentativeTax: number;
  beaAtDeathYear: number;
  dsueReceived: number;
  applicableExclusion: number;      // BEA + DSUE
  unifiedCredit: number;
  federalEstateTax: number;         // max(0, tentativeTax - unifiedCredit)

  // State Tax
  stateEstateTaxRate: number;
  stateEstateTax: number;

  // Totals
  totalEstateTax: number;           // federal + state
  totalTaxesAndExpenses: number;    // totalEstateTax + admin

  // Portability
  dsueGenerated: number;            // first death only; ported to survivor

  // Payments
  estateTaxDebits: Array<{ accountId: string; amount: number }>;

  // Creditor-payoff (final death only)
  creditorPayoffDebits: Array<{ accountId: string; amount: number }>;
  creditorPayoffResidual: number;
}
```

`EntitySummary` changes:

```ts
export interface EntitySummary {
  ...
  // grantors: {name, pct}[] REMOVED
  grantor?: "client" | "spouse";   // undefined = third-party grantor
}
```

`DeathEventResult` gains:

```ts
export interface DeathEventResult {
  ...
  estateTax: EstateTaxResult;
  dsueGenerated: number;   // first-death only; projection.ts stashes for final-death
}
```

`ProjectionYear` gains:

```ts
export interface ProjectionYear {
  ...
  estateTax?: EstateTaxResult;   // populated only on death-event years
}
```

`DeathTransfer.via` gains one value:

```ts
via: ... | "trust_pour_out";
```

### Per-grantor adjusted-taxable-gifts helper

`src/lib/estate/adjusted-taxable-gifts.ts`:

```ts
export function computeAdjustedTaxableGifts(
  decedent: "client" | "spouse",
  gifts: Gift[],
  entities: EntitySummary[],
  annualExclusionsByYear: Record<number, number>,
): number;
```

Sum of:
- For each `gift` with `gift.grantor === decedent`: `max(0, amount − annualExclusionForYear)`.
- For each `gift` with `gift.grantor === "joint"`: half of the above.
- For each `entity` where `entity.grantor === decedent`: all of `entity.exemptionConsumed` (opening advisor-entered balance).

Third-party-grantor trusts (`entity.grantor === undefined`) contribute 0.

The annual exclusion per year is read from `tax_year_parameters.giftAnnualExclusion`
(already in the DB, already loaded by the projection-data route).

Replaces the UI's current hardcoded `LIFETIME_EXEMPTION_CAP = 13_990_000`.
The UI is updated in plan 4d-1 to use `beaForYear(currentYear, ...)` for
its remaining-exemption display; the magic number is deleted.

### Zod schemas

`src/lib/schemas/plan-settings.ts` adds two optional numeric fields to
the PATCH body:

- `estateAdminExpenses: z.number().nonnegative().optional()`
- `flatStateEstateRate: z.number().min(0).max(1).optional()`

`src/lib/schemas/entities.ts` swaps the `grantors` array schema for a
single `grantor: z.enum(["client", "spouse"]).nullable().optional()`.

## Gross estate rules

Gross estate is built by iterating post-precedence-chain account and
liability state and emitting one `GrossEstateLine` per includible item.

### Assets

| Shape | First death | Final death |
|---|---|---|
| `owner === deceased`, no `ownerEntityId` | 100% FMV | 100% FMV |
| `owner === "joint"` (defensive — shouldn't exist post-4b) | 50% FMV | not applicable |
| `owner === survivor` | 0 | N/A |
| `ownerFamilyMemberId` set (already inherited via prior 4b) | 0 | N/A |
| `ownerEntityId` set, entity `isIrrevocable === true` | 0 (ILIT + IDGT both excluded) | 0 |
| `ownerEntityId` set, entity `isIrrevocable !== true`, `entity.grantor === decedent` | 100% FMV | 100% FMV |
| `ownerEntityId` set, entity `isIrrevocable !== true`, `entity.grantor !== decedent` | 0 (different grantor, or third-party) | 0 |
| `category === "life_insurance"`, decedent is insured (owner = decedent), not in ILIT | face value (`accountBalances[id]`) | per owner rule |

`accountBalances[id]` is the FMV source. Basis is not relevant to
estate-tax computation.

### Liabilities

| Shape | First death | Final death |
|---|---|---|
| `ownerFamilyMemberId` set | 0 | 0 |
| `ownerEntityId` set, entity irrevocable | 0 | 0 |
| `ownerEntityId` set, entity revocable, `entity.grantor === decedent` | `balance` as negative line | `balance` as negative line |
| `linkedPropertyId` set, linked account owned by decedent | `balance` as negative | `balance` as negative |
| `linkedPropertyId` set, linked account joint | **50% balance** as negative | N/A |
| Unlinked household liability (no owner tags) | **50% balance** as negative (assumed 50/50 between spouses) | 100% balance as negative |

### Line labels

- Account: `${account.name}` + `" (${percentage * 100}%)"` when `percentage < 1`
- Liability: same pattern
- Revocable-trust asset: `${account.name} (Trust)`

## Deduction stack

```ts
function computeDeductions(input: {
  transferLedger: DeathTransfer[];
  externalBeneficiaries: ExternalBeneficiarySummary[];
  planSettings: PlanSettings;
  deathOrder: 1 | 2;
}): {
  maritalDeduction: number;
  charitableDeduction: number;
  estateAdminExpenses: number;
};
```

- **Marital deduction** — first death only: sum of `transferLedger[].amount`
  where `recipientKind === "spouse"`. Final death: 0.
- **Charitable deduction** — either death: sum of `transferLedger[].amount`
  where `recipientKind === "external_beneficiary"` AND the matching
  `externalBeneficiaries[]` row has `kind === "charity"`.
- **Estate admin expenses** — `planSettings.estateAdminExpenses` flat
  dollar, applied at both deaths.

### Charitable deduction data loader

Implementing charitable deduction requires the `ExternalBeneficiarySummary`
loader that was queued as follow-up from 4b (projection-data route
currently passes `externalBeneficiaries: []` to the death-event module,
so external recipients get the fallback "External beneficiary" label).
Plan 4d-1 pulls this follow-up forward and ships the loader as part of
the charitable-deduction task.

## Federal estate tax formula

IRC §2001(c) Unified Rate Schedule (constant, not DB-sourced — unchanged
since 1977):

```ts
// src/lib/tax/estate.ts
export const UNIFIED_RATE_SCHEDULE: ReadonlyArray<{ over: number; base: number; rate: number }> = [
  { over:         0, base:       0, rate: 0.18 },
  { over:    10_000, base:   1_800, rate: 0.20 },
  { over:    20_000, base:   3_800, rate: 0.22 },
  { over:    40_000, base:   8_200, rate: 0.24 },
  { over:    60_000, base:  13_000, rate: 0.26 },
  { over:    80_000, base:  18_200, rate: 0.28 },
  { over:   100_000, base:  23_800, rate: 0.30 },
  { over:   150_000, base:  38_800, rate: 0.32 },
  { over:   250_000, base:  70_800, rate: 0.34 },
  { over:   500_000, base: 155_800, rate: 0.37 },
  { over:   750_000, base: 248_300, rate: 0.39 },
  { over: 1_000_000, base: 345_800, rate: 0.40 },
];

export function applyUnifiedRateSchedule(amount: number): number {
  if (amount <= 0) return 0;
  const row = [...UNIFIED_RATE_SCHEDULE].reverse().find(r => amount > r.over)!;
  return row.base + row.rate * (amount - row.over);
}
```

Verifications:
- `applyUnifiedRateSchedule(15_000_000) === 5_945_800`
- `applyUnifiedRateSchedule(14_050_000) === 5_565_800`

`computeFederalEstateTax()` in `src/engine/death-event/estate-tax.ts`:

```ts
function computeFederalEstateTax(input: {
  taxableEstate: number;
  adjustedTaxableGifts: number;
  lifetimeGiftTaxAdjustment: number;  // 0 in v1
  beaAtDeathYear: number;
  dsueReceived: number;
}) {
  const tentativeTaxBase =
    input.taxableEstate + input.adjustedTaxableGifts + input.lifetimeGiftTaxAdjustment;
  const tentativeTax = applyUnifiedRateSchedule(tentativeTaxBase);
  const applicableExclusion = input.beaAtDeathYear + input.dsueReceived;
  const unifiedCredit = applyUnifiedRateSchedule(applicableExclusion);
  const federalEstateTax = Math.max(0, tentativeTax - unifiedCredit);
  return { tentativeTaxBase, tentativeTax, applicableExclusion, unifiedCredit, federalEstateTax };
}
```

### State estate tax

```ts
const stateEstateTax = Math.max(0, taxableEstate * planSettings.flatStateEstateRate);
```

No state-level exemption, no federal deduction for state tax paid, no
state-specific brackets. Advisors approximate effective state liability
via the flat rate.

### DSUE derivation

Simplified portability (100% auto-port, no cap, no election toggle):

```ts
const dsueGenerated = deathOrder === 1
  ? Math.max(0, applicableExclusion - tentativeTaxBase)
  : 0;
```

At first death, the survivor's projection-state picks up `dsueGenerated`
and threads it as `dsueReceived` into the final-death event. Fully
derived — no persistence. If two projection runs are needed (e.g., one
that stops mid-plan), recomputation is cheap.

At final death, `dsueGenerated = 0` — there's nobody left to port to.
Defensive invariant.

## Creditor-payoff and estate-tax payment

### Shared drain helper

`src/engine/death-event/creditor-payoff.ts`:

```ts
export interface DrainResult {
  debits: Array<{ accountId: string; amount: number }>;
  drainedTotal: number;
  residual: number;
}

export function drainLiquidAssets(input: {
  amountNeeded: number;
  accounts: Account[];
  accountBalances: Record<string, number>;
  eligibilityFilter: (acct: Account) => boolean;
}): DrainResult;
```

### Category order (hardcoded)

1. `cash`
2. `taxable`
3. `life_insurance`
4. `retirement`

`real_estate` and `business` are never eligible. If the liquid pool is
insufficient, `residual > 0` is returned — the caller decides what to do
with the shortfall.

### Within-category ordering

Proportional by balance. Deterministic, no alphabetic tie-breaks. E.g.,
two cash accounts with balances $10k and $30k, drain $8k → debits
$2k and $6k respectively.

### Eligibility filters

| Caller | Filter |
|---|---|
| Creditor-payoff (final death only) | `acct.owner === deceased` OR `acct.ownerEntityId` set and entity revocable with `grantor === deceased`. Post-4b retitling already moved survivor-side accounts out of `owner === deceased`, so this scopes to decedent's individual residuary. |
| Estate-tax payment at final death | Same as creditor-payoff. |
| Estate-tax payment at first death | Same base filter PLUS: exclude any account that the 4b transfer ledger routed to the survivor (marital share is off-limits). |

### Creditor-payoff call (final death only)

```ts
const unlinkedDebt = liabilities
  .filter(l => l.linkedPropertyId == null
            && l.ownerEntityId == null
            && l.ownerFamilyMemberId == null)
  .reduce((sum, l) => sum + l.balance, 0);

const drain = drainLiquidAssets({
  amountNeeded: unlinkedDebt,
  accounts: workingAccounts,
  accountBalances,
  eligibilityFilter: creditorPayoffFilter(deceased),
});

// Apply debits: subtract drain.debits[] from accountBalances.
// Extinguish liabilities proportional to drain.drainedTotal / unlinkedDebt.
// If drain.residual > 0 → call existing distributeUnlinkedLiabilities()
// on the residual debt amount (4c's proportional-to-heirs fallback).
```

Emits `creditor_payoff_insufficient_liquid` warning when `residual > 0`,
recording shortfall amount and debited accounts.

### Estate-tax payment call (both deaths)

```ts
const taxDrain = drainLiquidAssets({
  amountNeeded: totalTaxesAndExpenses,
  accounts: workingAccounts,
  accountBalances,
  eligibilityFilter: estateTaxPaymentFilter(deceased, deathOrder, transferLedger),
});

// Apply debits.
// If taxDrain.residual > 0 → emit `estate_tax_insufficient_liquid`.
```

For first-death tax payment (usually $0 because marital + BEA), the
filter protects the marital share. Residual in this case is effectively
"tax shortfall" — logged; the IRS-lien reality is not modeled.

### Side effects

- Subtracts from `accountBalances[id]`.
- Retirement-account drains emit `retirement_estate_drain` (informational)
  flagging future beneficiary ordinary-income tax (not modeled in v1).
- Account with balance drained to 0 is marked for removal from
  `workingAccounts` using the existing 4c cleanup pattern.
- Basis untouched; the 4c precedence chain handles basis on residual
  values.

### Ordering summary

At final death: gross estate computed on **pre-drain** balances (so debt
lines reflect what decedent owed at death) → creditor-payoff drain
physically extinguishes debts → deductions computed on the debt-folded
gross total → tax computed → estate-tax drain → 4c chain runs on
**post-drain** balances.

At first death: 4b chain runs first (determines marital deduction) →
gross on post-4b balances → deductions → tax → estate-tax drain (if
non-zero, restricted to non-marital residuary). No creditor-payoff at
first death — decedent's debts stay with the household.

## Grantor-trust succession

Single-grantor-per-trust simplification: v1 enforces this via DB schema
(`entities.grantor owner_enum NULL`) plus UI single-select. The
`grantors jsonb` column is dropped.

### Helper

`src/engine/death-event/grantor-succession.ts`:

```ts
export interface TrustSuccessionResult {
  entityUpdates: Array<{
    entityId: string;
    isGrantor?: boolean;
    isIrrevocable?: boolean;
    grantor?: "client" | "spouse" | null;
  }>;
  pourOutQueue: Array<{
    entityId: string;
    trustBeneficiaries: BeneficiaryRef[];  // entity.beneficiaries
  }>;
  warnings: string[];
}

export function applyGrantorSuccession(input: {
  deceased: "client" | "spouse";
  entities: EntitySummary[];
}): TrustSuccessionResult;
```

### Decision tree (per entity)

```
if entity.grantor !== <deceased>:
  skip — entity is unaffected.

if !entity.isIrrevocable:
  // Revocable trust, sole grantor just died.
  entityUpdates: { isGrantor: false, isIrrevocable: true, grantor: null }
  pourOutQueue: push — trust assets flow to entity.beneficiaries via
                       simplified precedence chain (see pour-out below).
elif entity.isIrrevocable AND entity.isGrantor:
  // IDGT where decedent was the income-tax grantor.
  // Trust continues as a standing irrevocable entity; income-tax status flips.
  entityUpdates: { isGrantor: false, grantor: null }
  warnings.push(`idgt_grantor_flipped: ${entityId}`);
  // NO pour-out.
```

Three branches total (including skip). No multi-grantor mechanics.

### Ordering relative to gross estate

`applyGrantorSuccession` runs **before** `computeGrossEstate()` at each
death. Gross estate reads post-succession entity state:
- Still-revocable trusts (where decedent was a grantor) already flipped
  to irrevocable at this point — succession zeros them out for future
  estates but the gross-estate rule above uses the `grantor === decedent`
  predicate against the *original* entity state for THIS event. To
  avoid an ordering gotcha, the gross-estate builder takes a snapshot of
  the pre-succession entities and consults *that* for the "was decedent
  the grantor?" question. Post-succession state is used for all other
  purposes (downstream years, the `ProjectionYear.estateTax` output).

### Trust pour-out

Pour-outs queued by succession are merged into the final-death 4c
precedence chain as a preceding step (before the will step), so the
decedent's will cannot try to bequeath trust-owned assets.

Pour-out uses a simplified precedence chain:
- **Step 1 (titling)** — skip (trusts don't have joint titling).
- **Step 2 (beneficiary designations)** — skip (trusts don't have
  account-level beneficiaries; they are the beneficiary pattern).
- **Step 3 (trust beneficiaries)** — treat `entity.beneficiaries[]` like
  a will's specific-bequest recipients. Distribute each trust account
  via `splitAccount()` per each beneficiary's percentage. Same
  owner-mutation rules as 4b/4c.
- **Step 4 (fallback)** — if `beneficiaries[]` empty or sum < 100%,
  fire residual to fallback tiers (tier-2 children, tier-3 system_default).
  Emit `trust_beneficiaries_incomplete` when sum < 100% and
  `trust_pour_out_fallback_fired` when tier-3 fires.

Ledger entries tagged `via: "trust_pour_out"`. Liabilities owned by the
pour-outing trust merge into the unlinked-debt pool for creditor-payoff
at final death.

## Assumptions form changes

`src/components/forms/tax-rates-form.tsx` grows a new "Estate Tax"
section below the existing Income Tax section. Two fields:

- **Estate administrative expenses** — dollar input (default $0).
- **State estate tax rate** — percent input (default 0%).

Both wired through the existing plan-settings PATCH pipeline. No new
API route.

## UI side-effects

- `src/components/family-view.tsx`: entity form's grantor UI changes
  from multi-grantor list to a single "Grantor" select (Client / Spouse /
  Third party). Existing `LIFETIME_EXEMPTION_CAP = 13_990_000` magic
  number is replaced with `beaForYear(currentYear, planSettings.taxInflationRate ?? planSettings.inflationRate)`.
- `projection-data/route.ts`: loads `external_beneficiaries` (the 4b
  follow-up) and threads them into `applyFirstDeath` / `applyFinalDeath`.

## Invariants (added to `assertInvariants` in each orchestrator)

Existing 4b/4c invariants continue to fire. 4d adds:

1. `estateTax.grossEstate >= 0` (sum of positive lines > sum of negatives).
2. `estateTax.taxableEstate >= 0` (clamped; defensive).
3. `estateTax.federalEstateTax >= 0` (clamped).
4. `estateTax.stateEstateTax >= 0` (clamped).
5. `estateTax.dsueGenerated >= 0` AND (`deathOrder === 2` implies `dsueGenerated === 0`).
6. `estateTax.applicableExclusion === beaAtDeathYear + dsueReceived`.
7. `sum(creditorPayoffDebits) ≤ total unlinked decedent debt pre-drain`.
8. `sum(estateTaxDebits) ≤ totalTaxesAndExpenses`.
9. No post-event entity has `isIrrevocable === true` AND `isGrantor === true` AND `grantor === <just-deceased>`.
10. No post-event account has `ownerEntityId` pointing to an entity whose
    `grantor === <just-deceased>` AND `!isIrrevocable` — any such entity
    must have been flipped to irrevocable and poured out.

## Warnings

- `creditor_payoff_insufficient_liquid` — drain residual > 0 at final death.
- `estate_tax_insufficient_liquid` — estate-tax drain residual > 0.
- `retirement_estate_drain` — retirement account debited (informational;
  flags future beneficiary income-tax work).
- `idgt_grantor_flipped` — IDGT grantor-trust status flipped; downstream
  income-tax treatment would change (future spec).
- `trust_beneficiaries_incomplete` — pour-outing trust has
  `beneficiaries[]` summing to < 100%.
- `trust_pour_out_fallback_fired` — trust pour-out hit tier-3
  `system_default`.
- `residual_fallback_fired` — existing 4c warning, re-emitted for 4d's
  final-death path when creditor-payoff residual falls to proportional
  distribution.

## Testing plan

### Unit tests

**`src/engine/death-event/__tests__/estate-tax.test.ts`**
- `applyUnifiedRateSchedule`: all 12 bracket boundaries, zero, negative (→ 0),
  $15M → $5,945,800, $14.05M → $5,565,800.
- `computeFederalEstateTax`: Form-706 line-for-line reproduction of the
  known screenshot math; zero-tax paths (small estate, everything-marital);
  above-BEA path; DSUE-consumed path; negative-taxable clamped to zero.
- `beaForYear`: 2026 = $15M; 2030 at 3% inflation; pre-2026 returns 2026.
- DSUE: first-death with partial, fully-consumed, zero-taxable-estate;
  final-death always 0.

**`src/engine/death-event/__tests__/grantor-succession.test.ts`**
- Revocable trust, client grantor, client dies → flipped + pour-out queued.
- IDGT, client grantor, client dies → isGrantor=false, no pour-out, warning.
- Third-party-grantor trust, client dies → skipped.
- Revocable spouse-grantor trust, client dies → skipped.
- Entity with `grantor === undefined` → skipped.

**`src/engine/death-event/__tests__/creditor-payoff.test.ts`** (drainLiquidAssets)
- Within-category drain: proportional splits.
- Spill across categories: cash drained fully, taxable partial.
- Insufficient pool: residual > 0, never touches real_estate/business.
- Zero amount needed: empty debits.
- Filter excludes all: residual === amountNeeded, debits empty.

**`src/lib/estate/__tests__/adjusted-taxable-gifts.test.ts`**
- Client grantor gifts → counted for client decedent only.
- Joint gifts split 50/50 per decedent.
- Annual exclusion subtracted and clamped at zero.
- Trust `exemptionConsumed` added when `entity.grantor === decedent`.
- Third-party-grantor trust excluded.

### Integration tests (`src/engine/__tests__/estate-tax-integration.test.ts`)

- Couple, everything to spouse: marital zeroes taxable, federal tax 0,
  DSUE = full BEA.
- Couple, $5M lifetime gifts, small residuary to children: `adjustedTaxableGifts`
  populated; federal tax 0 when base < exclusion; DSUE clamped appropriately.
- Couple, $20M lifetime gifts (exceeded BEA): tentativeBase > exclusion,
  federal tax > 0, DSUE = 0.
- Couple with joint revocable trust where client is grantor → pour-out at
  first death; spouse is beneficiary → marital deduction covers.
- Couple with ILIT on client's life → insurance excluded from gross,
  death benefit pour-out to trust beneficiaries.
- Single-filer, sole death, no prior DSUE.
- Couple survivor's death with stashed DSUE.
- Final death: unlinked credit-card debt < cash → drained, no residual,
  4c runs on reduced balance.
- Final death: unlinked debt > all liquid → residual falls to 4c
  proportional.
- Final death: estate tax > liquid pool → partial payment, warning.
- Revocable trust at final death → pour-out merges into 4c chain;
  ledger entries tagged `"trust_pour_out"`.
- State estate tax scenarios: rate 0, rate 8%.

### Regression

- All existing 4b/4c tests (`src/engine/__tests__/projection.test.ts`,
  `death-event.test.ts`) pass after file split + pipeline reshape at
  final death. 4c's pre-existing "4c distribution works" tests may need
  `estateAdminExpenses=0`, `flatStateEstateRate=0` defaults threaded; any
  failure is expected-and-fixable inside plan 4d-1.
- The `lifeExpectancy`-off-horizon regression from 4c's Task 9 continues
  to apply.

### Plan 4d-2 testing (out of scope here)

- Snapshot tests on the report page rendered against seeded
  `EstateTaxResult` values: zero-tax, marital-only, high-tax,
  creditor-payoff-insufficient, trust-pour-out scenarios. Plan 4d-2
  writes these.

## Edge cases

| Case | Handling |
|---|---|
| No gifts, no trusts, no BEA-consumption history | `adjustedTaxableGifts = 0`; formula reduces to `max(0, table(E) - table(BEA))` |
| Entire estate → spouse | `taxableEstate = 0`, federal = 0, full DSUE ports |
| Entire estate → charity | `taxableEstate = 0` after charitable deduction |
| Mixed marital + charitable + residuary | each deducted separately; residuary is taxable |
| `estateAdminExpenses > grossEstate` | `taxableEstate` clamped to 0 |
| Client dies first with zero individual assets (only joint) | gross = 50% joint only; marital deduction if 4b routes back to spouse |
| Single-filer with ILIT on own life | insurance excluded; death benefit pour-out to trust beneficiaries at sole death |
| Lifetime gifts exceed BEA | `adjustedTaxableGifts > BEA` possible, federal tax owed; `lifetimeGiftTaxAdjustment` still 0 in v1 (known limitation) |
| Final death in plan year 1, no first-death | single-filer path; `dsueReceived = 0` |
| `lifeExpectancy` exactly at `planEndYear` | existing 4b/4c boundary logic; 4d runs and projection truncates |
| Death year beyond `planEndYear` | `computeFinalDeathYear` returns null; 4d no-ops; no `estateTax` on any ProjectionYear |

## Packaging summary

### Plan 4d-1 ships

- `src/engine/death-event/` folder split (monolithic file cleanup).
- `estate-tax.ts`, `grantor-succession.ts`, `creditor-payoff.ts` modules.
- `src/lib/tax/estate.ts` with `UNIFIED_RATE_SCHEDULE`,
  `applyUnifiedRateSchedule`, `beaForYear`.
- `src/lib/estate/adjusted-taxable-gifts.ts` helper.
- DB migration (plan_settings + entities.grantor).
- Zod schema updates (plan-settings, entities).
- Assumptions tax-rates form Estate Tax section.
- Family-view single-grantor select; magic-number removal.
- `projection-data/route.ts` loads external_beneficiaries (pulled from
  4b follow-up).
- `EstateTaxResult` attached to `ProjectionYear.estateTax`.
- Full engine unit + integration test coverage from the testing plan.
- Updated `docs/future-work/estate.md` with 4d follow-ups (gift tax
  paid, §2035 add-back, state exemption tables, IDGT income-tax pass,
  multi-grantor support, report page → 4d-2).

### Plan 4d-2 ships

- New route: `src/app/(app)/clients/[id]/estate-tax-report/page.tsx`.
- Client component rendering the eMoney-style breakdown for each death
  year from `EstateTaxResult`.
- Navigation wiring (layout sidebar entry).
- Snapshot tests per Section "Plan 4d-2 testing."

## Self-review checklist

- [x] Placeholder scan: no TBD/TODO/"similar to" tokens.
- [x] Internal consistency: pipeline sections (first death vs final death)
      match the helper invocations listed in the `File layout` split.
      Creditor-payoff only at final death; estate-tax drain at both.
- [x] Scope check: split into two plans (4d-1 engine+data, 4d-2 report).
- [x] Ambiguity check: single-grantor-per-trust enforced; multi-grantor
      is explicitly future-work. BEA formula is a single pure function;
      no DB column conflict. Flat state rate has no exemption/bracket
      ambiguity.
- [x] Terminology section distinguishes statutory Form 706 terms from
      any third-party derivations.
