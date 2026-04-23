# Estate Planning — Spec 4c: Final-Death Asset Transfer

**Date:** 2026-04-23
**Scope:** The engine event that ends the household. Fires at the final
death — the survivor of a couple (after 4b), or a single-filer-from-start
client's sole death. Runs the same precedence chain as 4b with three
condition deltas, distributes unlinked household liabilities
proportionally to heirs, emits a unified death-transfer ledger, and
truncates the projection.
**Chain:** 4a (wills data) → 4b (first-death transfer) → **4c (final-death transfer)** → 4d (estate tax + grantor-trust succession) → 4e (liability bequests).

## Goal

When the final grantor dies mid-projection, produce engine state that
reflects the end of the household:

- Remaining individually-owned accounts of the final deceased are routed
  through the precedence chain (titling → designations → will →
  fallback) to family-member heirs, entities, externals, or the
  system_default sink.
- Unlinked household liabilities are distributed proportionally across
  final-tier recipients — family-member recipients take on a new
  engine-synthesized liability; external / system_default recipients
  take their proportional share out of the model with their asset
  share.
- All remaining household income streams are terminated at the
  final-death year.
- A single unified `DeathTransfer[]` ledger — covering both 4b (death
  order 1) and 4c (death order 2) — is attached to each death year's
  `ProjectionYear` row.
- The projection hard-stops at the end of the final-death year. No
  `ProjectionYear` rows are emitted for `year > finalDeathYear`.

## Non-goals

- **Estate tax** (federal + state) — Spec 4d.
- **Step-up in basis** at death — item 6. 4c divides basis
  proportionally on splits but does not adjust to fair market value.
- **Life-insurance death-benefit payout** — item 7.
- **Liability bequest overrides** — **Spec 4e**. Advisors cannot route
  specific debts to specific heirs in v1. 4c's proportional distribution
  is the only mechanic. When 4e lands, it will extend the will schema
  and inject a new pre-proportional step into the 4b+4c pipeline.
- **Grantor-trust succession at death** — 4d. Entity-owned accounts and
  liabilities pass through 4c untouched.
- **Inherited-IRA SECURE Act 10-year rule** — logged future-work.
  Retirement accounts inherited by non-spouse recipients are modeled as
  normal accounts under the new owner.
- **Multi-generational projection** — later. Heir sub-projections are
  composed from the transfer ledger; 4c's hard stop does not preclude
  them.
- **Qualifying-surviving-spouse 2-year MFJ extension** — irrelevant at
  4c (no survivor).
- **Beneficiary-designation contingent tier** — primaries only (carried
  from 4b).

All future-work deferrals are tracked in
[docs/future-work/estate.md](../../future-work/estate.md).

## Trigger

Two new pure helpers alongside the existing `computeFirstDeathYear` /
`identifyDeceased`:

```ts
// Later of the two assumed death years for a couple; the client's death
// year for a single-filer. null if the computed year falls past planEndYear.
export function computeFinalDeathYear(
  client: ClientInfo,
  spouseBirthYear: number | null,
  planEndYear: number,
): number | null;

// For a couple post-4b, returns the survivor. For a single-filer,
// always returns "client".
export function identifyFinalDeceased(
  client: ClientInfo,
  firstDeceased: "client" | "spouse" | null,
): "client" | "spouse";
```

`computeFinalDeathYear`:

- Couple: `max(clientBirthYear + client.lifeExpectancy, spouseBirthYear + (client.spouseLifeExpectancy ?? 95))`.
- Single-filer (`spouseBirthYear == null`): `clientBirthYear + client.lifeExpectancy`.
- If `> planEndYear`, returns `null` — 4c no-ops. Matches 4b's
  past-horizon behavior.

## Precedence chain — diff from 4b

The four-step chain from 4b is reused; step behaviors differ as follows.

| Step | 4b | 4c |
|---|---|---|
| 1 — Titling | Retitles joint accounts via right-of-survivorship. | **No-op.** No joint accounts can exist at 4c — all joint accounts were retitled to the survivor at 4b, and a single-filer client has none by construction. Step skipped; no ledger entries. |
| 2 — Beneficiary designations | Fires on accounts with `beneficiaries[]`. | **Same logic.** Note: accounts retitled at 4b had `beneficiaries` cleared (4b owner-mutation rule), so step 2 at 4c only fires on accounts the advisor re-designated on the survivor's side, or on the single-filer client's original designations. |
| 3 — Will | Uses first-deceased's will. Condition filter: `always=fire, if_spouse_survives=fire, if_spouse_predeceased=skip`. | Uses **final-deceased's will**. Condition filter: `always=fire, if_spouse_survives=skip, if_spouse_predeceased=fire`. For a single-filer client, the advisor UI shouldn't present spouse-conditional options — but if either condition is present in the data (migrated or hand-edited), the engine treats `if_spouse_predeceased` as firing (no living spouse is the single-filer state) and `if_spouse_survives` as skipping. |
| 4 — Fallback | Tier 1 (spouse) always fires. | **Tier 1 skipped** — no surviving spouse. Tier 2 (living children, even split) goes live; tier 3 (system_default "Other Heirs") is last-resort sink. Emits `residual_fallback_fired` warning as in 4b. |

Implementation changes to shared step code:

- `applyFallback` gains a `skipTier1: boolean` param. 4b passes `false`; 4c passes `true`.
- `firesAtFirstDeath(b: WillBequest)` becomes `firesAtDeath(b: WillBequest, deathOrder: 1 | 2)` — inverts the condition-tier check by order.

Account mutation rules (owner-by-recipient-kind table, split mechanic
A, basis splitting) are unchanged from 4b. `recipientKind === "spouse"`
is dead code at 4c and is flagged by a defensive invariant check.

## Architecture

Extend `src/engine/death-event.ts` in place (no subfolder split). Add:

```ts
export function applyFinalDeath(
  input: DeathEventInput,
): DeathEventResult;
```

Pure function. No I/O. Reuses every existing step function
(`applyBeneficiaryDesignations`, `applyWillSpecificBequests`,
`applyWillAllAssetsResidual`, `applyFallback`, `applyIncomeTermination`,
`splitAccount`). File grows from ~970 → ~1150 LOC. If/when the file
crosses a pain threshold, split into `src/engine/death-event/` folder
with `shared.ts` / `first-death.ts` / `final-death.ts` as a separate
cleanup pass per the 4b handoff's "don't preemptively split"
guidance.

### Input

`DeathEventInput` is unchanged from 4b — same shape, same loader.

### Output

`DeathEventResult` is unchanged in structure from 4b, with one renamed
field:

```ts
export interface DeathEventResult {
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  // effectiveFilingStatusFromNextYear dropped for 4c — projection
  // truncates, so no post-event tax pass consumes it. Shape kept on
  // the 4b return value (at first death filing status does transition).
  transfers: DeathTransfer[];          // renamed from FirstDeathTransfer[]
  warnings: string[];
}
```

### Pipeline within `applyFinalDeath`

1. Run the precedence chain (steps 1–4) over each individually-owned
   deceased account → produces asset `transfers`.
2. Compute each final-tier recipient's **estate share** =
   `sum(transfer.amount where recipient = R) / sum(all transfer.amount)`.
3. For each unlinked household liability (`linkedPropertyId == null`
   and `ownerEntityId == null`), distribute `balance × recipientShare`:
   - Family-member recipient → synthesize a new `Liability` row with
     `ownerFamilyMemberId = recipientId`, proportional `balance` /
     `monthlyPayment`, same `interestRate` / `startYear` / `termMonths` /
     `compounding`. Emit a ledger entry with
     `via: "unlinked_liability_proportional"` and `amount: negative`.
   - External / system_default recipient → no new liability row
     (the debt leaves the model with the asset share). Emit a ledger
     entry with negative `amount` so net-by-recipient reflects the
     liability.
4. Remove the original unlinked household liabilities from
   `workingLiabilities`.
5. Run `applyIncomeTermination(deceased = finalDeceased)`.
6. Assert invariants; throw on violation.

### Edge cases for Feature A (proportional liability distribution)

- **Zero-estate deceased with unlinked debt.** Denominator is 0 — no
  recipient to proportion against. Drop the liability, emit
  `unlinked_liability_no_estate_recipient` warning. Rare.
- **All recipients receive via external / system_default only.** Debt
  proportionally leaves the model with them. Intentional — matches the
  "ride along with the asset" principle.

### Type change: `Liability.ownerFamilyMemberId`

```ts
export interface Liability {
  // ...existing fields...
  ownerFamilyMemberId?: string | null; // engine-set; null for household debts
}
```

Downstream consumers (balance-sheet rollup, payments-by-owner report)
must respect this field consistently with how `Account.ownerFamilyMemberId`
is treated. Verify during implementation; no production consumer exists
today, but future reports / timeline drill-ins will need to exclude
family-member-owned liabilities from household cash-flow.

## Stream termination

All remaining household incomes are clipped at the final-death year.
Entry state (post-4b for couples, original state for single-filer):

- `owner === firstDeceased` — already `endYear = firstDeathYear` from
  4b's termination. No-op at 4c.
- `owner === survivor` (the current final-deceased) — clip:
  `endYear = finalDeathYear`.
- `owner === "joint"` — impossible. Invariant check throws if present.
- `ownerEntityId` set — untouched. Entity income is 4d's concern.

Single-filer variation (no 4b):

- `owner === "client"` — clip.
- No `owner === "spouse"` / `"joint"` by construction.
- `ownerEntityId` — untouched.

Reuses existing `applyIncomeTermination(deceased, year)` helper —
already parameterized.

## Filing status

No resolver change at 4c. Projection truncates at
`year === finalDeathYear`; there is no post-event tax pass. MFJ / single
determination for the death year itself follows the existing 4b
precedent (death-year uses the configured / 4b-set filing status).

## Ledger unification

Rename `FirstDeathTransfer` → `DeathTransfer`. Add `deathOrder`
discriminator. Extend `via` union with `unlinked_liability_proportional`.
Add source / resulting fields for liability entries.

```ts
export interface DeathTransfer {
  year: number;
  deathOrder: 1 | 2;                      // 1 = 4b, 2 = 4c
  deceased: "client" | "spouse";
  sourceAccountId: string | null;         // null when this entry is a liability transfer
  sourceAccountName: string | null;       // frozen at event time; null for liability
  sourceLiabilityId: string | null;       // set only for unlinked_liability_proportional
  sourceLiabilityName: string | null;     // frozen at event time; null for asset transfers
  via:
    | "titling"
    | "beneficiary_designation"
    | "will"
    | "fallback_spouse"                   // 4b only
    | "fallback_children"
    | "fallback_other_heirs"
    | "unlinked_liability_proportional";  // 4c only
  recipientKind:
    | "spouse"                             // 4b only
    | "family_member"
    | "entity"
    | "external_beneficiary"
    | "system_default";
  recipientId: string | null;
  recipientLabel: string;
  amount: number;                          // positive for asset; negative for liability
  basis: number;                           // 0 for liability entries
  resultingAccountId: string | null;       // synthetic account id if kept in household
  resultingLiabilityId: string | null;     // synthetic liability id for family-member recipient; null otherwise
}
```

`ProjectionYear` shape:

```ts
// Before:
firstDeathTransfers?: FirstDeathTransfer[];
deathWarnings?: string[];

// After:
deathTransfers?: DeathTransfer[];          // may include both order-1 and order-2 entries
deathWarnings?: string[];                  // name unchanged; covers both events
```

**Rename scope.** Single refactor commit at the top of the plan:
`src/engine/types.ts`, `src/engine/death-event.ts`,
`src/engine/projection.ts`, `src/engine/__tests__/death-event.test.ts`,
`src/engine/__tests__/projection.test.ts`. All 4b tests continue to
pass with the renamed type.

## Year-loop integration

```ts
// Existing 4b block — unchanged semantics; renamed ledger field:
if (firstDeathYear != null && year === firstDeathYear) {
  const deathResult = applyFirstDeath({ /* ... */ });
  // ...mutate working state as today...
  thisYear.deathTransfers = deathResult.transfers;  // renamed
  thisYear.deathWarnings = deathResult.warnings;
}

// NEW 4c block — fires the same year as 4b in the same-year double-death
// case, or in a later year for the normal case.
if (finalDeathYear != null && year === finalDeathYear) {
  const finalResult = applyFinalDeath({
    year,
    deceased: finalDeceased,
    will: (data.wills ?? []).find(w => w.grantor === finalDeceased) ?? null,
    accounts: workingAccounts,
    accountBalances,
    basisMap,
    incomes: currentIncomes,
    liabilities: currentLiabilities,
    familyMembers: data.familyMembers ?? [],
    externalBeneficiaries: [],
    entities: data.entities ?? [],
  });

  workingAccounts = finalResult.accounts;
  // in-place mutation of accountBalances / basisMap / currentIncomes / currentLiabilities

  thisYear.deathTransfers = [
    ...(thisYear.deathTransfers ?? []),
    ...finalResult.transfers,
  ];
  thisYear.deathWarnings = [
    ...(thisYear.deathWarnings ?? []),
    ...finalResult.warnings,
  ];

  break;  // Hard stop.
}
```

Case matrix:

| Case | `firstDeathYear` | `finalDeathYear` | Loop behavior |
|---|---|---|---|
| Couple, distinct deaths | A | B > A | 4b fires at A; loop continues with survivor state; 4c fires at B; truncate. |
| Couple, same-year double death | A | A | 4b fires at A (client first by convention); 4c fires same year on 4b-mutated state; both orders attach to ProjectionYear at A; truncate. |
| Single-filer client | `null` | C | 4b no-ops; 4c fires at C; truncate. |
| Past-horizon final death | `null` or A | `null` | 4b may or may not fire (per 4b rules); 4c no-ops; loop runs to planEndYear. |

## Invariants

Asserted at end of `applyFinalDeath`; violations throw.

- Sum of `transfer.amount` per `sourceAccountId` equals the account's
  EoY-death-year balance (±$0.01). Asset transfers only.
- For each unlinked household liability, sum of `-transfer.amount`
  across its recipient shares equals the liability's EoY balance
  (±$0.01).
- No account remains with `owner === finalDeceased && !ownerEntityId && !ownerFamilyMemberId`.
- No account remains with `owner === "joint"` (defensive — should
  already be ruled out by 4b).
- No income with `owner === finalDeceased && !ownerEntityId && endYear > finalDeathYear`.
- No transfer has `recipientKind === "spouse"` (tier 1 skipped; defensive
  check catches data-model bugs where a primary designation or will
  clause routes to the already-deceased survivor).

## Warnings and errors

### Warnings (non-fatal; appended to `DeathEventResult.warnings`)

| Code | Meaning |
|---|---|
| `residual_fallback_fired` | Any account hit step 4 at 4c. Signals incomplete will. |
| `bequest_targets_missing_account` | Specific-asset bequest's `accountId` doesn't exist among final-deceased's accounts. Clause skipped. |
| `bequest_targets_beneficiary_designated_account` | Specific bequest targets an account already fully drained by designations. |
| `over_allocation_in_will` | Specific-clause percentages at one condition tier sum > 100% for an account. Engine pro-rates. |
| `fallback_children_recipient_deceased` | Family-member child flagged deceased before death year. Skipped from tier-2 even-split denominator. Goes live at 4c. |
| `unlinked_liability_no_estate_recipient` | Zero-estate deceased has unlinked debt but no asset transfers to ride along with. Liability dropped. |
| `fallback_all_tiers_exhausted` | Defensive — all three fallback tiers emitted zero transfers. Tier 3 should always fire as last resort. |

### Fatal errors

| Error | Condition |
|---|---|
| `bequest_recipient_not_found` | Will recipient ID references a nonexistent family-member / external / entity. API layer should catch first. |
| (invariant violations) | Routing math didn't account for 100%, owner cleanup failed, or defensive checks tripped. |

## Edge cases

1. **Same-year double death.** 4b fires first (client by convention
   from 4b spec), then 4c runs on 4b-mutated state same year. Both
   orders attach to the same `ProjectionYear` row. MFJ tax for the
   death year. Projection truncates.
2. **Single-filer client.** 4b no-ops. 4c fires at the client's death
   year. Condition filter: `if_spouse_predeceased` fires (vacuously
   true). Proportional liability distribution works. Truncates.
3. **Final death past plan horizon.** `finalDeathYear === null`. 4c
   no-ops; loop runs to `planEndYear`.
4. **Final deceased has no individually-owned accounts.** Chain
   produces zero asset transfers; unlinked-liability step emits
   `unlinked_liability_no_estate_recipient` warning (if any unlinked
   debt exists) and drops them. Termination step runs. Invariants
   satisfied (no deceased-owned accounts to violate them).
5. **Will exists but all clauses have `if_spouse_survives` condition
   only.** All clauses skip at 4c; every account falls through to
   step 4. `residual_fallback_fired` per account. Tier 2 or 3 distributes.
6. **Entity-owned accounts.** Untouched by 4c. 4d's concern.
7. **Entity-owned liabilities.** Untouched by 4c. 4d's concern.
8. **Retirement account to non-spouse recipient.** In reality, SECURE
   Act 10-year rule applies. v1 treats as normal account under new
   owner; logged future-work.

## Testing plan

| Layer | Coverage |
|---|---|
| Unit — `computeFinalDeathYear` | Couple (max of two deaths); single-filer (client's death); past-horizon (null); same-year double death |
| Unit — `identifyFinalDeceased` | Couple post-4b (survivor); single-filer ("client") |
| Unit — `applyFallback` with `skipTier1` | Tier 1 skipped; tier 2 fires; tier 2 empty → tier 3 fires; warning emitted |
| Unit — `firesAtDeath(b, 2)` | `always` fires; `if_spouse_survives` skips; `if_spouse_predeceased` fires |
| Unit — unlinked-liability distribution | Proportional math across multiple recipients; family-member recipient gets new liability with `ownerFamilyMemberId`; external recipient → liability removed; zero-estate with debt → warning + drop; entity-owned liability untouched |
| Unit — income termination at 4c | Survivor salary clipped; entity-owned untouched; single-filer client salary clipped |
| Unit — invariants | Asset sum mismatch throws; liability sum mismatch throws; lingering `owner === finalDeceased` throws; `owner === "joint"` throws; `recipientKind === "spouse"` throws |
| Unit — `applyFinalDeath` orchestrator | End-to-end pipeline on a synthetic scenario (chain + liability distribution + termination + invariants) |
| Integration — couple, distinct death years | 4b fires at A; 4c fires at B; no rows past B; ledger has order-1 entries on A and order-2 entries on B; balances + incomes + liabilities reflect both |
| Integration — same-year double death | Both orders attach to the same ProjectionYear; MFJ tax for death year; truncation works |
| Integration — single-filer client | 4b no-ops; 4c fires at client's death; proportional liability distribution; truncation |
| Integration — past-horizon final death | 4b + 4c no-op; projection runs to planEndYear as today |
| Regression | Full existing suite passes unchanged after the `FirstDeathTransfer` → `DeathTransfer` rename (first commit of the plan) |

**Test-data helper.** Extend `makeClientData()` to accept
`finalDeathYearOverride`. Existing tests that set `lifeExpectancy`
inside the plan horizon may need to either push it off-horizon or
configure the 4c scenario fully, same regression-risk pattern 4b
navigated.

## Gotchas carried from 4a / 4b

- **`ClientData.familyMembers`** and **`ClientData.entities`** are
  already loaded for 4b; 4c reuses them.
- **Pre-existing tests without 4c scenarios.** Any test with
  `lifeExpectancy` inside horizon but no wills / family-members
  configured will now fire 4c fallback tier 3 (system_default) since
  tier 1 is skipped and no children are configured. Mitigation: push
  `lifeExpectancy` off-horizon in those tests — do not change engine
  logic.
- **`externalBeneficiaries: []`** is still passed through by the
  projection-data loader; same follow-up as 4b's label-resolution.
- **`Account.value` staleness risk** remains (4b follow-up). 4c reads
  `accountBalances[id]` consistently; don't introduce a new
  `Account.value` read without replicating the fix.
- **Filing status.** No new thread; 4b's `effectiveFilingStatus`
  resolver is unused past `finalDeathYear` because the loop truncates.
- **Next.js in this repo ≠ training data** — not relevant for
  engine-only work but keep the practice.

## Downstream consumers (not built here)

- **Spec 4d — estate tax engine.** Consumes the unified
  `DeathTransfer[]` ledger to compute federal (+ portability/DSUE) and
  state estate tax at each death year. 4d's "debts of decedent"
  deduction is the eventual home for realistic creditor-payoff
  modeling (supersedes 4c's simple proportional-to-heirs
  distribution).
- **Spec 4e — liability bequest overrides.** Extends the will schema
  and injects a pre-proportional step into 4b+4c. Advisor can then
  route specific debts to specific heirs.
- **Item 6 — step-up in basis.** Updates the proportional basis 4c
  sets on splits to fair-market-value at death.
- **Balance-sheet report + estate Sankey.** Consume the unified
  ledger to render both 4b and 4c flows in one view.
- **Multi-generational projection.** Composes heir sub-projections
  seeded from the `DeathTransfer[]` ledger. 4c's hard stop is the
  natural seam.
