# Savings Rule Enhancements — Design Spec

**Date:** 2026-04-19
**Branch:** `apr19-improvements-batch`
**Scope:** items 1, 2, 4, 5 from the 2026-04-19 improvement batch, plus one
new ask: employee contributions as `$` or `% of salary`.

## Goal

Tighten the savings-rule experience in three related ways:

1. Let advisors mark a savings-rule contribution as tax-deductible (or not)
   per rule, with smart defaults per account subtype.
2. Unify the employer-match UI between the add-account create-mode Savings
   form and the SavingsRuleDialog — advisors currently see different controls
   in the two places and the create-mode form silently lacks the "flat $"
   match mode.
3. Let employee contributions on workplace-retirement accounts be entered as
   a percent of salary instead of a flat dollar amount, reusing the same
   salary-resolution plumbing that employer-match percent already uses.

Item 5 from the batch (aligning edit controls between the income-expenses
Savings list and the account-edit Savings tab) is **satisfied implicitly**
by the work above — both entry points already share `SavingsRulesList` and
`SavingsRuleDialog`, so once the dialog's employer-match UI is fixed (item
2) and the list row shows match summaries (item 4), the remaining gap
disappears. No separate task.

## Item-by-item summary

| # | Item | Status |
|---|---|---|
| 1 | Contribution-deductibility checkbox on savings rules | In this spec |
| 2 | Employer-match UI consistency between add-account & dialog | In this spec |
| 4 | Show employer match on savings-list rows | In this spec |
| 5 | Align edit controls between income-expenses & account-edit | Satisfied by items 2 + 4 |
| — | NEW: Employee contribution as `$` or `% of salary` | In this spec |

## Schema changes

Two new columns on `savings_rules`. Both additive; no backfill math required.

| Column | Type | Default | Purpose |
|---|---|---|---|
| `is_deductible` | `boolean not null` | `true` | Per-rule override of whether the contribution counts as an above-the-line deduction. UI only surfaces the checkbox for pre-tax retirement subtypes (see UI rules below). Engine gates reads on subtype eligibility AND this flag — an errant `true` on a cash-savings rule never deducts. |
| `annual_percent` | `decimal(6,4) null` | `null` | When non-null, engine resolves this rule's contribution as `ownerSalary * annual_percent` per year. When null, engine uses `annual_amount` as today. Mutually exclusive in effect: both columns may hold values (so the UI can remember the last-entered dollar amount when the user toggles to percent mode and back), but only one drives the engine per year. |

`annual_amount` remains `not null` (unchanged). Existing `employer_match_*`
columns unchanged.

### Migration

Two statements:

1. Add columns with safe defaults (`is_deductible boolean not null default true`,
   `annual_percent decimal(6,4) null`).
2. Backfill: flip `is_deductible = false` for existing rules whose account
   subtype is `other`.

```sql
UPDATE savings_rules
SET is_deductible = false
WHERE account_id IN (SELECT id FROM accounts WHERE sub_type = 'other');
```

Why the backfill is needed: `other` is in the new
`DEDUCTIBLE_ELIGIBLE_SUBTYPES` set (so the checkbox appears in the UI), but
the UI default for new `other` rules is **unchecked**. Without the backfill,
every existing `other` savings rule would start deducting after deployment —
unintended behavior change. The backfill aligns stored state with the UI
default.

Rules on `traditional_ira` and `401k` need no backfill — default `true` is
correct (they deduct today and should continue). Rules on Roth subtypes and
on ineligible subtypes (cash, taxable) will have `is_deductible = true`
stored but the engine ignores it because the subtype isn't in
`DEDUCTIBLE_ELIGIBLE_SUBTYPES`.

One intentional behavior change the migration enables: existing rules on
`403b` accounts (a subtype the current engine silently fails to deduct) will
begin producing above-line deductions after this ships. This is the bug fix
called out in "Risks".

Follow the project's drizzle-kit pattern (apply DDL manually if drizzle-kit
silently skips — see `a6c0e1a`, `9594be1` in repo history). The backfill
UPDATE must also be run manually if drizzle-kit skips.

## UI — three new shared components

All three live under `src/components/forms/` beside the existing savings-rule
components. Each is used in BOTH the add-account-form create-mode inline
Savings form AND the SavingsRuleDialog, eliminating the current divergence.

### `<EmployerMatchFields>`

- Three-mode radio group: **None** / **% of salary** / **Flat $**.
- Percent mode: two inputs side-by-side — match percent (`employerMatchPct`)
  and cap-% of salary (`employerMatchCap`, optional).
- Flat mode: single currency input (`employerMatchAmount`).
- Gated on account subtype via the existing `EMPLOYER_MATCH_SUB_TYPES`
  constant (`401k`, `roth_401k`, `403b`, `roth_403b`, `other`). Consolidates
  the duplicated copies of this constant (flagged in memory S2858) into the
  new module.
- Props: current values, onChange for each, `subType` for gating, an error
  slot for validation messages.

### `<ContributionAmountFields>`

- Two-mode radio group: **Dollar amount** / **% of salary**.
- Dollar mode: single currency input (`annualAmount`).
- Percent mode: single percent input (`annualPercent`) plus muted hint text:
  "Resolves against the account owner's salary each year. No salary → no
  contribution."
- The mode toggle **only renders** for subtypes `401k`, `403b`, `roth_401k`,
  `roth_403b`, `other` (retirement). For every other subtype the component
  renders only the dollar input — no toggle, no percent path.
- Mode-preservation UX: when the user toggles modes, the previously-typed
  value in the other mode is preserved in local state until save, so the
  toggle round-trip is non-destructive.

### `<DeductibleContributionCheckbox>`

- Single checkbox labeled **"Contribution is tax-deductible (pre-tax)"**.
- Gated visibility per account subtype:

| Subtype | Checkbox shown? | Default when creating a new rule |
|---|---|---|
| `traditional_ira` | Yes | Checked |
| `401k` | Yes | Checked |
| `403b` | Yes | Checked |
| `roth_ira`, `roth_401k`, `roth_403b` | Hidden | n/a |
| `other` (retirement) | Yes | Unchecked |
| All other subtypes (cash, taxable, 529, etc.) | Hidden | n/a |

- Eligibility set exported as `DEDUCTIBLE_ELIGIBLE_SUBTYPES` and consumed by
  both the UI and the engine derive function (single source of truth).

## Changes to existing components

### `src/components/forms/savings-rule-dialog.tsx`

- Replace the existing inline 3-mode employer-match UI with
  `<EmployerMatchFields>`.
- Replace the existing single-currency contribution input with
  `<ContributionAmountFields>`.
- Insert `<DeductibleContributionCheckbox>` above the save button (between
  the contribution amount/percent fields and the employer-match section is
  the natural placement since it describes the advisor's contribution, not
  the match).
- Extend the `SavingsRuleRow` interface (and the POST/PUT payloads it
  builds) with `isDeductible: boolean` and `annualPercent: string | null`.

### `src/components/forms/add-account-form.tsx`

- Create-mode Savings form: swap the inline `%` + `cap` employer-match
  fields for `<EmployerMatchFields>`, swap the contribution-amount input
  for `<ContributionAmountFields>`, insert
  `<DeductibleContributionCheckbox>`.
- Remove the local copy of `EMPLOYER_MATCH_SUB_TYPES` (import from the new
  `employer-match-fields.tsx` module instead). Same for
  `showEmployerMatch` flag logic — move into the new component.
- Extend `accountSavingsRules` state shape and POST payloads to include
  the new fields.

### `src/components/forms/savings-rules-list.tsx`

Row rendering changes (layout "A" from the brainstorm):

```
$18,000/yr                               [Edit] [Delete]
2024–2060 · +50% match up to 6%
```

or, when the contribution is stored as a percent:

```
10% of salary/yr                         [Edit] [Delete]
2024–2060 · +$3,000 match
```

Text format rules:

- Primary line: `$X/yr` (today) unless `annualPercent` is set, in which case
  `P% of salary/yr` (decimal `annualPercent` rendered as whole-number %).
- Year line: append ` · ` followed by the match summary **only if** the
  rule has any match configured.
- Match summary text:
  - `annualMatchAmount > 0` → `+$X match`
  - `employerMatchPct > 0` + `employerMatchCap > 0` → `+P% match up to C%`
  - `employerMatchPct > 0` only → `+P% match`
  - None of the above → append nothing

No deductibility badge on the row (scoped out — advisor sees it in the dialog).

## Engine changes

### `src/engine/savings.ts`

- Keep `computeEmployerMatch(rule, salary)` as-is.
- Add `resolveContributionAmount(rule, salary): number` implementing:

```ts
if (rule.annualPercent && salary > 0) return salary * rule.annualPercent;
return Number(rule.annualAmount);
```

Note: when percent mode is set and there's no salary for the year, the
contribution resolves to `0` — matching the employer-match behavior.

### `src/engine/projection.ts`

- Extract the salary-by-owner lookup block at [projection.ts:915-933](../../src/engine/projection.ts#L915-L933) into a helper (new file
  or sibling in `savings.ts`): `resolveOwnerSalary(rule, salaryByOwner, incomeSalariesTotal, accounts) → number`.
- Call sites:
  - Existing employer-match path: now `computeEmployerMatch(rule, resolveOwnerSalary(...))`.
  - New employee-contribution path: replace the direct
    `Number(rule.annualAmount)` read at the contribution-application step
    with `resolveContributionAmount(rule, resolveOwnerSalary(...))`.

### `src/engine/types.ts`

- Add `isDeductible: boolean` (required, no default — loader maps DB row to
  this) and `annualPercent: number | null` to the `SavingsRule` interface.

### `src/lib/tax/derive-deductions.ts`

- Rename `DEDUCTIBLE_SUBTYPES` → `DEDUCTIBLE_ELIGIBLE_SUBTYPES`. Add
  `"403b"`. Export it (so the UI gating can import the same set).
- In `deriveAboveLineFromSavings`, change the per-rule predicate from:

```ts
if (!DEDUCTIBLE_SUBTYPES.has(acct.subType)) continue;
```

to:

```ts
if (!DEDUCTIBLE_ELIGIBLE_SUBTYPES.has(acct.subType)) continue;
if (!rule.isDeductible) continue;
```

The per-year `annualAmount` accumulation step also needs to use the resolved
amount, not the flat column, so percent-mode contributions count correctly:

```ts
total += resolveContributionAmount(rule, ownerSalary);
```

(This requires passing `salaryByOwner` through to the derive function.
Plumb it the same way employer match receives it — from the caller in
`projection.ts`.)

## Loader / API changes

### `src/app/api/clients/[id]/projection-data/route.ts`

- Map the two new DB columns into engine input:
  - `isDeductible: row.isDeductible`
  - `annualPercent: row.annualPercent ? Number(row.annualPercent) : null`

### Savings-rule CRUD routes

- Accept the two new fields on POST/PUT/PATCH payloads. Default
  `isDeductible` to `true` on create when the subtype is eligible, `false`
  when the subtype is `other`, omit when the subtype is ineligible (the
  column will just hold its default).
- Validate: `annualPercent` if present must be in `(0, 1]` (we store as a
  decimal ratio, so 1 = 100%; the UI input is in %).

## Tests

New and updated test cases:

- `src/engine/__tests__/savings.test.ts`
  - "resolves contribution amount as salary × percent when annualPercent is
    set"
  - "falls back to annualAmount when annualPercent is null"
  - "percent-mode contribution with zero salary resolves to 0"

- `src/lib/tax/__tests__/derive-deductions.test.ts`
  - "includes 403b rules in above-line deductions" (confirms the bug fix)
  - "excludes rules where isDeductible is false even if subtype is eligible"
  - "counts percent-mode contributions using resolved salary × percent"

- No RTL component tests required (repo has none today; manual smoke test of
  the three new components is the established pattern).

## Verification

Run after each task and before the branch lands:

- `npx tsc --noEmit`
- `npx vitest run`
- `npm run build`
- Manual UI walkthrough:
  1. Add a new 401(k) account; confirm the create-mode Savings form shows
     the deductible checkbox (checked), the contribution dollar/percent
     toggle, and the 3-mode employer match UI.
  2. Add a percent-mode employee contribution + percent-mode employer
     match + cap. Save. Confirm row renders `X% of salary/yr` and
     `YYYY–YYYY · +M% match up to C%`.
  3. Open the same rule in the account-edit Savings tab; confirm all three
     sections (deductible, contribution mode, match mode) render
     identically to the dialog.
  4. Edit a rule in the income-expenses page Savings section; confirm the
     dialog shows the 3-mode match radio (previously missing — flagged by
     the user as the original prompt for item 2).
  5. Spot-check the engine: create a traditional-IRA rule, uncheck the
     deductible box, save, run a projection, confirm the above-line
     deduction drops.

## Out of scope

- IRS contribution limits (401k/403b deferral caps, IRA limits). Tracked
  separately in FUTURE_WORK.
- Traditional-IRA deduction phase-out for high earners with workplace plan.
  Tracked separately.
- 529 state-level deductions. Tracked separately.
- Employer-match ledger fix in the legacy cash-flow path (FUTURE_WORK entry
  `Employer match when using legacy cash-flow path`).
- Any refactor of SavingsRulesList beyond adding the new summary line.
- Item 5 is explicitly not a separate task (see "Goal").

## Risks

- **Migration safety.** Additive columns + defaults mean no downtime; the
  known drizzle-kit silent-skip bug is a process risk, not a design risk —
  handled by the manual-DDL fallback pattern.
- **403b deduction bug fix is a behavior change** for any existing client
  with a `403b` savings rule. Mitigated by: those clients were under-deducting
  today (the current behavior is wrong), and the fix is opt-in per rule via
  the same `is_deductible` flag.
- **Salary lookup edge cases.** Joint-owned accounts with both spouses
  having separate salaries already behave correctly for employer match
  (documented in the Agent report); the same plumbing is reused for
  employee percent-mode contributions, so risk is bounded to the existing
  behavior.
