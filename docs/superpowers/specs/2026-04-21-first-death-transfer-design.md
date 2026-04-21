# Estate Planning — Spec 4b: First-Death Asset Transfer

**Date:** 2026-04-21
**Scope:** The first engine consumer of the 4a wills data model. At the
year of the first grantor's death, execute the precedence chain
(titling → beneficiary designations → will → fallback) to mutate
post-death engine state, emit an out-of-household transfer ledger, and
transition the survivor's filing status.
**Chain:** 4a (wills data) → **4b (first-death transfer)** → 4c (second-death distribution) → 4d (grantor-trust survivorship).

## Goal

When the first spouse dies mid-projection, produce engine state that
reflects reality from year+1 onward: accounts re-owned per the
precedence chain, the deceased's personal income streams stopped, a
single-filer tax computation for the survivor, and a machine-readable
ledger of where every deceased-owned dollar went (including out-of-
household transfers for later estate-tax / Sankey / report consumers).

## Non-goals

- **Second-death distribution** — 4c's job. 4b's fallback chain is
  defined completely (tiers 1, 2, 3) so 4c inherits the rule, but only
  tier 1 ever fires at first death.
- **Federal or state estate tax** — item 5 in the master estate roadmap.
- **Step-up in basis at death** — item 6. 4b divides basis
  proportionally on splits but does not adjust it to fair market value.
- **Life insurance death benefit payout** — item 7.
- **Grantor-trust succession at first death** — 4d. 4b treats entity-
  owned accounts as unaffected by the grantor's death; their ownership
  and rollup rules don't change here.
- **Inherited-IRA RMD mechanics** (SECURE Act 10-year rule) — logged as
  future-work. A retirement account willed to a non-spouse is treated
  as a normal account with the new owner in v1.
- **Qualifying-surviving-spouse 2-year MFJ extension** — real IRS rule,
  rarely material; logged as future-work. v1 flips to single filer
  immediately in year+1.
- **Beneficiary-designation contingent tier** — primaries only in v1.
  Contingent-tier logic is logged as future-work.
- **Intestate state-law succession** — replaced by the deterministic
  spouse → children → Other Heirs fallback chain.

All future-work deferrals are tracked in
[docs/future-work/estate.md](../../future-work/estate.md).

## Precedence chain

At the death of a grantor, each account they owned (wholly or jointly)
flows through steps in strict order. Each step claims a fraction; the
undisposed remainder cascades.

### Step 1 — Titling (joint accounts only)

If `account.owner === "joint"`, the deceased's 50% passes to the
survivor via right-of-survivorship. The account's `owner` flips from
`"joint"` to the survivor (`"client"` or `"spouse"`). No split needed
since the survivor already held the other 50%. One ledger entry emitted
with `via: "titling"`.

Individually-owned accounts skip this step.

### Step 2 — Beneficiary designations

Applies to any account carrying `beneficiaries: BeneficiaryRef[]`
(retirement, TOD/POD, life insurance). For each **primary**
beneficiary on the account, their stated `percentage` × current
undisposed fraction routes to that recipient. One ledger entry per
designation with `via: "beneficiary_designation"`.

Contingent-tier logic (redirect if primary predeceases) is v1-deferred
— at first death the deceased is the grantor, not a beneficiary, so
primaries being alive is the common case. Contingent support is
logged as future-work.

If designations sum to less than 100%, the remainder cascades to
step 3.

### Step 3 — Will

Only fires for the deceased (`will.grantor === deceased`). Bequests
are filtered by condition tier at first death:

- `"always"` — fires
- `"if_spouse_survives"` — fires (survivor is alive by definition)
- `"if_spouse_predeceased"` — skipped

Clauses execute in `sort_order`.

**3a. Specific-asset bequests** (`asset_mode === "specific"`)
matching the current account: route `bequest.percentage × undisposedPct`
across the clause's recipients, each taking their sub-`percentage` of
that allocation. One ledger entry per `(bequest, recipient)` with
`via: "will"`. Subtract the claimed fraction from `undisposedPct`.

**3b. "All other assets" bequests** (`asset_mode === "all_assets"`)
apply only to accounts where **no specific clause** in this will
claimed any share. If multiple `all_assets` clauses exist (uncommon),
their percentages are treated as a split of the residual among
themselves.

Per 4a's data model, `all_assets` is a bucket-level residual, not an
account-level residual. If a specific clause claimed only part of an
account (e.g., "40% of brokerage to Sarah"), the remaining 60% does
NOT flow to `all_assets` — it falls through to step 4.

### Step 4 — Fallback chain

Fires when `undisposedPct > 0` after steps 1–3. Emits a
`residual_fallback_fired` warning on every invocation — it signals
incomplete will data.

- **Tier 1: surviving spouse.** All residual → survivor.
- **Tier 2: living children.** (No spouse — 4c territory; wired now
  for symmetry.) Split residual evenly across
  `family_members.relationship === "child"` rows whose assumed death
  year has not yet passed.
- **Tier 3: system-default "Other Heirs" sink.** Residual leaves the
  household entirely; emits ledger entry with
  `recipientKind: "system_default"`, no new account row.

At first death tier 1 always applies. Tiers 2 and 3 are dead code in
4b and become live in 4c.

## Architecture

New module: `src/engine/death-event.ts`. Single entry point:

```ts
export function applyFirstDeath(
  input: DeathEventInput,
): DeathEventResult;
```

Pure function. No DB access, no I/O. Reads state in, returns new state
+ ledger + warnings. Easy to unit-test in isolation.

### Input

```ts
export interface DeathEventInput {
  year: number;                                 // death year
  deceased: "client" | "spouse";
  survivor: "client" | "spouse";
  will: Will | null;                            // from ClientData.wills, filtered by grantor
  accounts: Account[];                          // current workingAccounts
  accountBalances: Record<string, number>;      // EoY-of-death-year balances
  basisMap: Record<string, number>;
  incomes: Income[];
  liabilities: Liability[];
  familyMembers: FamilyMember[];                // for tier-2 child resolution
  entities: EntitySummary[];                    // for grantor-trust detection
}
```

### Output

```ts
export interface DeathEventResult {
  accounts: Account[];                          // post-death; splits + mutations applied
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  incomes: Income[];                            // deceased-owner streams retitled or clipped
  liabilities: Liability[];                     // liabilities linked to split/removed accounts handled
  effectiveFilingStatusFromNextYear: "single";  // consumed by the year-loop tax pass
  transfers: FirstDeathTransfer[];              // ledger; one entry per (source-account × recipient)
  warnings: string[];
}
```

### New `FamilyMember` on `ClientData`

`ClientData` does not currently carry family members. Add:

```ts
export interface FamilyMember {
  id: string;
  relationship: "child" | "grandchild" | "parent" | "sibling" | "other";
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;    // ISO date; null = unknown
}

// ClientData additions
familyMembers?: FamilyMember[];
```

Loader in `projection-data/route.ts` queries `family_members` for the
client and attaches.

### Engine-loop integration

`src/engine/projection.ts` — at the end of each year's loop iteration,
after tax is calculated and the `ProjectionYear` row is finalized:

```ts
const firstDeathYear = computeFirstDeathYear(client, spouseBirthYear);
if (firstDeathYear != null && year === firstDeathYear) {
  const deathResult = applyFirstDeath({...});
  workingAccounts = deathResult.accounts;
  accountBalances = deathResult.accountBalances;
  basisMap = deathResult.basisMap;
  incomes = deathResult.incomes;           // mutated copy for next year's computeIncome call
  currentLiabilities = deathResult.liabilities;
  filingStatusOverride = "single";         // applied to tax from year+1 onward
  currentProjectionYear.firstDeathTransfers = deathResult.transfers;
  currentProjectionYear.deathWarnings = deathResult.warnings;
}
```

`computeFirstDeathYear`: pure helper in the same module.
`min(clientBirthYear + client.lifeExpectancy, spouseBirthYear + (client.spouseLifeExpectancy ?? 95))`
— or `null` if the client has no spouse or the death falls outside
the plan horizon.

## Account mutations

For each account touched by the precedence chain, the death-event
module produces a list of `(recipient, fraction)` pairs. The list
drives state changes:

### 100% single-recipient case

No split. Mutate the original account in place:

- Keep `id`, `name`, balance, basis, growth rate, realization, etc.
- Apply owner change per the recipient-kind table below.
- Clear `beneficiaries` (the new owner's designations, not the deceased's).

Preserves the original id for any downstream consumer holding a
reference.

### Split case (fraction < 100% or recipient count > 1)

Remove the original account. Create one synthetic account per recipient
share:

- `id`: freshly-generated synthetic id (reuses the `_syntheticId`
  counter pattern from `asset-transactions.ts`)
- `name`: `"${original.name} — to ${recipientLabel}"`
- `value = original.value × f`
- `basis = original.basis × f`
- Inherit `growthRate`, `rmdEnabled`, `realization`, `annualPropertyTax`,
  `propertyTaxGrowthRate` unchanged
- `beneficiaries` dropped
- Owner fields set per the recipient-kind table

Sum of split fractions equals 100% of the deceased's undisposed
portion (+ joint's surviving half if step 1 fired on a joint account,
which is the non-split case).

### Owner assignment by recipient kind

| Recipient kind                        | Mutation on target account                                                                                | Post-event household-visible?    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `spouse`                              | `owner = survivor`; clear `ownerFamilyMemberId`/`ownerEntityId`                                           | Yes                              |
| `family_member`                       | `ownerFamilyMemberId = recipientId`; clear `ownerEntityId`; `owner` set to `survivor` as a placeholder (family-member owner dominates in `resolveAccountOwner`) | Yes, family-member-scoped        |
| `entity` (grantor trust)              | `ownerEntityId = recipientId`; leave `owner`/`ownerFamilyMemberId` alone                                   | Yes (grantor-trust rollup)       |
| `entity` (non-grantor / irrevocable)  | `ownerEntityId = recipientId`; leave `owner`/`ownerFamilyMemberId` alone                                   | No (out-of-estate rollup)        |
| `external_beneficiary`                | Account **removed** from `workingAccounts`, `accountBalances`, `basisMap`                                  | No                               |
| `system_default` (fallback tier 3)    | Account **removed** from `workingAccounts`, `accountBalances`, `basisMap`                                  | No                               |

For the two "removed" cases, the transfer ledger captures the amount —
that's how the estate-tax engine (item 5) and later report surfaces
(Sankey, "where did it go") will know where it went.

### Liabilities

A liability with `linkedPropertyId = originalAccountId` follows its
account:

- **Original kept whole with new owner:** liability record unchanged.
- **Original split:** one liability per split, each with
  `balance × f`, `monthlyPayment × f`, same `interestRate`,
  `startYear`, `termMonths`. Each new liability's `linkedPropertyId`
  repoints to the corresponding new synthetic account id.
- **Original removed (external / system-default):** liability also
  removed. (Debts-follow-assets simplification: the recipient-
  beneficiary assumed the obligation along with the property.)

Liabilities without a `linkedPropertyId` (and without `ownerEntityId`)
are household liabilities today; they remain with the survivor by
default. No mutation needed.

## Stream termination + filing status

### Incomes

Extend the existing owner-scoped death-year suppression (currently only
in `computeIncome` for SS rows) to cover all income types:

- `owner === deceased` and no `ownerEntityId`: income clipped at death
  year's end; year+1 onward the row is treated as no longer active.
  Death year itself runs to completion (matches MFJ-for-year-of-death
  treatment).
- `owner === "joint"` and no `ownerEntityId`: `owner` retitled to
  `survivor`; no termination.
- `ownerEntityId` set: untouched. Entity-owned income continues; the
  entity's own story (succession / termination) is 4d's concern.

Implementation: `applyFirstDeath` returns a post-event `incomes` array
with deceased-owner rows marked clipped. Simplest representation — set
`endYear = deathYear` on matching rows. `computeIncome` already
respects `startYear`/`endYear` bounds, so no additional engine-side
logic needed.

### Expenses

No individual-owner field exists on `Expense` (non-entity expenses are
household). Survivor inherits everything. No 4b change.

### Filing status

`ClientInfo.filingStatus` is a single value today. Rather than
mutating it mid-projection, introduce a thin per-year resolver in
the tax pass:

```ts
function effectiveFilingStatus(
  client: ClientInfo,
  firstDeathYear: number | null,
  year: number,
): FilingStatus {
  if (firstDeathYear != null && year > firstDeathYear) return "single";
  return client.filingStatus ?? "single";
}
```

Tax code (both bracket and flat modes) reads
`effectiveFilingStatus(...)` rather than `client.filingStatus`
directly. Death year itself still uses the configured status (MFJ
survives the year of death).

## Transfer ledger

`FirstDeathTransfer[]` attached to the projection output so downstream
consumers have a single source of truth:

```ts
export interface FirstDeathTransfer {
  year: number;
  deceased: "client" | "spouse";
  sourceAccountId: string;           // original pre-split id
  sourceAccountName: string;          // frozen at event time
  via:
    | "titling"
    | "beneficiary_designation"
    | "will"
    | "fallback_spouse"
    | "fallback_children"
    | "fallback_other_heirs";
  recipientKind:
    | "spouse"
    | "family_member"
    | "entity"
    | "external_beneficiary"
    | "system_default";
  recipientId: string | null;         // null for spouse and system_default
  recipientLabel: string;             // e.g., "Spouse", "Sarah (child)", "Community Foundation", "Other Heirs"
  amount: number;                     // end-of-death-year value at transfer time (no step-up in v1)
  basis: number;                      // proportional basis
  resultingAccountId: string | null;  // synthetic id if kept in household; null if removed
}
```

**Attachment:** appended to the death year's `ProjectionYear` row as
`firstDeathTransfers?: FirstDeathTransfer[]` alongside a
`deathWarnings?: string[]` field. `runProjection` currently returns
`ProjectionYear[]` — keeping the attachment per-year avoids breaking
the return shape, and transfers are inherently year-keyed anyway.
Non-death years don't carry the fields (undefined is cheaper than
an empty array proliferating across the horizon).

**Shape:** one entry per `(sourceAccount × recipient)` pair. A single
account that splits 3 ways produces 3 entries. A joint account that
passes 100% via titling produces one entry.

**Invariants** (asserted at end of `applyFirstDeath`; violations
throw — these are bugs, not data issues):

- Sum of `transfer.amount` grouped by `sourceAccountId` equals that
  account's EoY-death-year balance (± $0.01).
- No account remains in `workingAccounts` with
  `owner === deceased && !ownerEntityId && !ownerFamilyMemberId`.
- No income in the post-event `incomes` with
  `owner === deceased && !ownerEntityId && endYear > deathYear`.

## Warnings and errors

### Warnings (non-fatal; append to engine output)

| Warning code                                       | Meaning                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `residual_fallback_fired`                          | Any account hit step 4. Signals incomplete will data.                                     |
| `bequest_targets_missing_account`                  | A specific-asset bequest's `accountId` doesn't exist among deceased-owned accounts. Clause silently skipped. |
| `bequest_targets_beneficiary_designated_account`   | A specific-asset bequest targets an account already fully drained by step 2. Clause is a no-op (unless designations claimed less than 100%). |
| `over_allocation_in_will`                          | Specific bequest percentages at a single condition tier sum > 100% for an account. Engine pro-rates. |
| `fallback_children_recipient_deceased`             | (4c-relevant) family-member child flagged deceased before death year. Skipped from even-split denominator. |

### Fatal errors

| Error                              | Condition                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `bequest_recipient_not_found`      | Will recipient's `recipientId` references a nonexistent family-member / external / entity. Defensive — API layer should catch first. |
| (invariant violations listed above) | Routing math didn't account for 100% of a source account, or owner-cleanup failed. |

`death_year_outside_plan_horizon` is **not** an error — it's a silent
no-op. No death event fires if the computed first-death year is past
`planEndYear`.

### Edge cases

1. **Both spouses die in the same year.** Compare `clientDeathYear`
   vs `spouseDeathYear`; if equal, client dies first by deterministic
   convention (documented). Second death that same year is 4c's
   concern.
2. **Single-filer client (no spouse at plan start).** No
   `spouseLifeExpectancy` → 4b no-ops; the sole client's death is 4c
   territory.
3. **Deceased already has no individually-owned accounts.** Steps 1–2
   run, step 3 finds nothing, no fallback fires. Normal completion
   with a possibly-empty transfer ledger (joint-titling entries may
   still be present).
4. **Will exists but has zero bequests.** All deceased-owned
   accounts fall through to step 4 tier 1. Survivor inherits
   everything; one `residual_fallback_fired` warning per account.
5. **Retirement account to non-spouse recipient.** In reality an
   inherited IRA with SECURE Act 10-year distribution rules. v1
   treats as a normal account under the new owner; logged as
   `inherited-ira-mechanics` in future-work.

## Testing plan

| Layer                          | Coverage                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Unit — death-event module      | Per-step tests for the precedence chain (titling, bene-designations, specific bequest, multi-recipient split, `all_assets` residual, condition filter, fallback tiers 1/2/3, account-split math, invariant violations throw) |
| Unit — income termination      | Salary owned by deceased ends year+1; joint salary retitles; entity-owned income unaffected           |
| Unit — filing-status resolver  | `effectiveFilingStatus(year)` flips from configured → `single` at `year > firstDeathYear`             |
| Integration — projection loop  | 2-spouse household, first death mid-horizon: balances reflect post-death ownership, tax is single-filer in year+1, transfer ledger sums match pre-death deceased-owned balances, warnings present/absent as expected |
| Integration — edge cases       | Single-filer client (4b no-op); same-year double death (only first fires); zero individually-owned accounts |
| Regression                     | Full `engine/__tests__/projection.test.ts` suite passes unchanged (existing tests don't configure wills → 4b no-ops) |
| Snapshot                       | One deterministic full-projection snapshot with a complete estate scenario — guards against silent shape changes |

**Test data:** extend `makeClientData()` helper in
`engine/__tests__/helpers/` to accept `wills`, `beneficiaryDesignations`,
`familyMembers`, and `deathYearOverride` (matches the pattern items 1–3
established).

## Gotchas carried from items 1–4a

- **`ClientData` evolution.** Adding `familyMembers` is a structural
  addition; ensure every `makeClientData()` call site in existing tests
  still works with it absent (optional field).
- **Filing-status threading.** Every tax code path (flat + bracket,
  federal + state) must switch to `effectiveFilingStatus(year)`. Grep
  for `client.filingStatus` during implementation — it should have
  zero remaining direct reads after 4b.
- **Pre-existing lifeExpectancy SS suppression** in `income.ts` must
  continue to work; 4b's generalization to all income types should
  produce the same behavior for SS rows (no regression).
- **Next.js in this repo ≠ training data** — not directly relevant
  since this is engine-only, but keep the practice going.

## Downstream consumers (not built here)

- **Spec 4c** — second-death distribution. Mirrors 4b's chain with the
  condition filter inverted and fallback tiers 2+3 becoming live.
- **Spec 4d** — grantor-trust succession at first death. Currently
  entity-owned accounts are untouched by 4b; 4d decides what happens
  when the sole grantor of a revocable trust dies.
- **Item 5 — estate-tax engine.** Consumes the transfer ledger to
  compute federal (+ portability/DSUE) and state estate tax at each
  death year.
- **Item 6 — step-up in basis.** Will update the proportional basis
  4b sets on splits to fair-market-value.
- **Balance-sheet report and "what goes where" Sankey.** Consume the
  transfer ledger to render the estate flow.
