# Social Security UI Redesign — Design Spec

**Date:** 2026-04-19
**Branch:** `social-security`
**Scope:** Relocate Social Security data entry to a dedicated, hardcoded section on the Income tab. Replace the generic Income add/edit flow for SS with a focused SS-specific dialog. Add claim-age "living link" modes (FRA / At Retirement) and a `no_benefit` option.

## Background

The initial Tier 1+2 implementation (see [2026-04-19-social-security-design.md](./2026-04-19-social-security-design.md)) wired Social Security into the generic Income row flow: advisors added SS the same way they add salary or trust income, via the "Add Income" button and the shared `IncomeDialog`. This shipped but surfaces two product issues:

1. **Discoverability.** SS is a first-class, per-person retirement artifact, not an arbitrary income line. Advisors expect to see SS for each person in the household at a glance, not discover it only after opening a dropdown and picking a type. Burying SS inside the generic income list doesn't match how advisors talk about or model it.

2. **Field overload.** The generic income form exposes schedule overrides, taxation type, cash-account routing, and custom names — none of which apply to SS. SS taxability always runs through Pub 915, SS benefits always deposit to household checking, and SS benefits don't need per-year overrides (COLA handles that). Showing those fields is visual noise and a source of user error.

This redesign addresses both issues by giving SS a hardcoded section with its own edit dialog — while keeping the underlying data model and math from the first Tier 1+2 pass intact.

## Scope

### In scope

- **Dedicated SS card** on the Income tab, below the existing income list. Always rendered; 1 row for single clients, 2 rows for married/partnered.
- **SS removed from the generic income flow**:
  - `social_security` no longer appears in the "Add Income" type dropdown.
  - SS rows are filtered out of the main income list.
  - SS-specific branching removed from `IncomeDialog`.
- **New focused edit dialog** (`SocialSecurityDialog`) with only SS-relevant fields.
- **Claim-age modes** — three new user-facing options stored as `claimingAgeMode`:
  - `"fra"` (default) — engine resolves to the person's FRA from DOB at projection time. Living link.
  - `"at_retirement"` — engine resolves to the person's retirement age at projection time. Living link.
  - `"years"` — existing behavior; user picks specific year + month (62-70, 0-11).
- **No-benefit mode** — new `ssBenefitMode: "no_benefit"` value for clients who will not receive SS in the projection (pre-WEP placeholder).
- **Lazy row creation** — the SS card renders even when no underlying DB row exists yet. First save creates the row.
- **Fields hidden (but preserved in the underlying row):** name, type, owner, startYear, endYear, scheduleOverrides, taxType, cashAccountId, inflationStartYear.

### Out of scope (deferred to FUTURE_WORK.md)

| Capability | Why deferred |
|---|---|
| Exempt Pension / WEP (blocks FICA + benefit) | Tier 5 — separate feature; `no_benefit` covers the display case |
| Tier 3 claim-strategy UI ("Help Me Compare") | Unchanged — still Tier 3 in FUTURE_WORK |
| Tier 4 PIA-from-income / wage history | Unchanged — still Tier 4 in FUTURE_WORK |
| Per-scenario SS overrides | Lives in future Scenarios feature |

## UX

### Location

Below the existing Income list on the Income tab. The income list retains its add button; the SS card is independently rendered and always visible.

### SS card (collapsed state)

For each person (client; spouse if present), one row as a summary pill:

```
┌───────────────────────────────────────────────────────────────┐
│ Dan Mueller · PIA · FRA (67y 0mo) · $33,600/yr est.         >│
├───────────────────────────────────────────────────────────────┤
│ Sarah Mueller · — Not configured —                           >│
└───────────────────────────────────────────────────────────────┘
```

- First-name lookup from `ClientInfo.firstName` (client row) or `ClientInfo.spouseName` (spouse row).
- Mode label: "PIA", "Annual", or "No Benefit".
- Claim-age label matches the mode: "FRA (67y 0mo)", "At Retirement (65)", "66y 6mo".
- First-year benefit estimate: shown only when computable (has PIA or annual amount; has resolvable claim age).
- Row is clickable anywhere; hover state matches existing clickable rows in the app.
- When no DB row exists for that owner yet, the summary shows "— Not configured —" and clicking still opens the dialog (empty form).

### SS edit dialog

Triggered by clicking a card row. Separate component from the generic `IncomeDialog`. Smaller, focused modal.

**Dialog fields in order:**

1. Header: "Edit {First Name}'s Social Security".

2. Read-only FRA display (only when DOB is set): *"Full Retirement Age: 66y 4mo (born 1956)"*.

3. **Benefit mode** (radio group):
   - Primary Insurance Amount (PIA) — default for new rows
   - Annual benefit amount
   - No Benefit

4. Conditional amount input based on mode:
   - `pia_at_fra` → "Monthly PIA" number input. Helper: "From your SSA statement — monthly benefit at FRA".
   - `manual_amount` → "Annual benefit amount" number input.
   - `no_benefit` → no input; grey copy: *"This person will receive no Social Security benefit in the projection."*

5. **Claim age mode** (radio group; disabled/hidden when `no_benefit`):
   - Full Retirement Age — default. Disabled with tooltip "Set date of birth to use FRA" when the owner's DOB is missing.
   - At Retirement — disabled with tooltip "Set retirement age to use this option" when the owner's retirement age is missing (spouse edge case).
   - Specific Age — when selected, reveals two inline dropdowns: year (62-70) and month (0-11).

6. **Annual COLA % field** (step 0.1, default = `planSettings.inflationRate` when the row has no stored value).

7. Live preview when all required inputs are present:
   *"Estimated first-year benefit: $33,600"*.
   Math: `computeOwnMonthlyBenefit({ piaMonthly, claimAgeMonths: resolved, dob }) × 12 × (1 + growthRate)^yearsFromToday`.
   In `manual_amount` mode the preview shows `annualAmount × (1 + growthRate)^yearsFromToday`.

8. Buttons: Cancel · Save.

**What's explicitly removed from this dialog** (but preserved on the underlying DB row so nothing breaks): name, type, owner, start/end year, schedule/overrides, tax type, cash account, inflationStartYear.

### First-save behavior

If no underlying DB row exists for the owner when the user clicks Save, the dialog POSTs a new `incomes` row with:

- `type: "social_security"`
- `owner`: "client" or "spouse" (which card was clicked)
- `name`: `"{First Name}'s Social Security"`
- `annualAmount`: `0` (engine ignores when `pia_at_fra` / `no_benefit`)
- `startYear`: current calendar year
- `endYear`: `2099`
- `growthRate`: value from the COLA field
- `inflationStartYear`: current calendar year
- `ssBenefitMode`, `piaMonthly`, `claimingAge`, `claimingAgeMonths`, `claimingAgeMode`: from the form

If a row exists, the dialog PUTs only the SS-managed fields; all other fields on the row are left untouched.

### Deletion

SS cards are not deletable. Users who want "no benefit" pick the `no_benefit` mode.

## Data Model

### TypeScript `Income` type ([src/engine/types.ts](../../../src/engine/types.ts))

Two changes on the SS-specific optional fields:

```ts
/** SS-specific. When unset, engine treats as "manual_amount" (legacy). */
ssBenefitMode?: "manual_amount" | "pia_at_fra" | "no_benefit";
/** SS-specific. When unset, engine treats as "years" (legacy). */
claimingAgeMode?: "years" | "fra" | "at_retirement";
```

All other SS fields (`piaMonthly`, `claimingAge`, `claimingAgeMonths`) stay as-is.

### DB schema

One new nullable column on `incomes`:

```sql
ALTER TABLE "incomes" ADD COLUMN "claiming_age_mode" text;
```

New drizzle migration file. Existing rows have NULL → treated as `"years"` (backward compatible).

`ss_benefit_mode` column is already `text`, so `"no_benefit"` is just a new valid value — no migration required for that.

### Backward compatibility

- `claiming_age_mode IS NULL` → `"years"` (existing behavior)
- `ss_benefit_mode IS NULL` → `"manual_amount"` (existing behavior, unchanged from the first SS spec)
- Existing SS rows in the DB render in the new card with their existing mode and claim-age values intact.

## Engine Resolution

### New helper: `resolveClaimAgeMonths`

```ts
// src/engine/socialSecurity/claimAge.ts
import type { Income, ClientInfo } from "../types";
import { fraForBirthDate } from "./fra";

/**
 * Resolve the effective claim age for a Social Security income row in
 * total months (years*12 + months). Returns null when the mode is
 * unresolvable (e.g., "fra" mode with missing DOB, or "at_retirement"
 * for a spouse with no spouseRetirementAge). Callers treat null as
 * "not yet claimed" — no benefit is emitted.
 */
export function resolveClaimAgeMonths(row: Income, client: ClientInfo): number | null {
  const mode = row.claimingAgeMode ?? "years";

  if (mode === "fra") {
    const dob = row.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
    if (!dob) return null;
    return fraForBirthDate(dob).totalMonths;
  }

  if (mode === "at_retirement") {
    const age = row.owner === "spouse" ? client.spouseRetirementAge : client.retirementAge;
    if (age == null) return null;
    return age * 12;
  }

  // "years" — existing behavior, including legacy rows with no mode set
  if (row.claimingAge == null) return null;
  return row.claimingAge * 12 + (row.claimingAgeMonths ?? 0);
}
```

### `no_benefit` short-circuit in `income.ts`

Earliest check in the SS branch:

```ts
if (inc.ssBenefitMode === "no_benefit") continue;
```

Row contributes nothing. No survivor benefit payable off the row — the orchestrator's existing `deceasedPia > 0` gate handles that case naturally, and `no_benefit` rows carry PIA 0 (or the engine ignores stored PIA entirely for `no_benefit` rows).

### Call sites updated

- `income.ts` SS branch:
  - Add the `no_benefit` short-circuit.
  - Replace inline `inc.claimingAge * 12 + ...` with `resolveClaimAgeMonths(inc, client)`.
  - Year-gate logic: convert the existing `year < claimingYear` comparison to use the resolved months (or skip the gate entirely since the orchestrator returns 0 for pre-claim years).

- `orchestrator.ts`:
  - Replace three inline claim-age computations with `resolveClaimAgeMonths(row, client)` / `resolveClaimAgeMonths(otherRow, client)`.
  - Treat a `null` result from the resolver as "not yet claimed" for gating purposes (the existing 0/false path handles this).

### Regression safety

All existing tests continue to pass:
- `manual_amount` regression tests — rows with `ssBenefitMode: "manual_amount"` (or null) never enter the PIA/orchestrator code paths, so the new resolver never runs for them.
- `pia_at_fra` tests with integer-year claim ages — `claimingAgeMode IS NULL` resolves as `"years"`, yielding identical results.
- Survivor / spousal orchestrator tests — same claim ages, same math.

### New test surface

- `claimAge.test.ts` — unit tests for all three modes × client/spouse owner × null-fallback branches.
- `orchestrator.test.ts` — at least one test per mode verifying the resolver integration.
- `income.test.ts` — `no_benefit` regression (returns 0 for that row), `claimingAgeMode: "fra"` end-to-end.
- `projection.test.ts` — one scenario with a `"fra"` mode row across years, verifying the living-link semantics.

## UI Architecture

### New component: `SocialSecurityCard`

File: `src/components/social-security-card.tsx`.

Props: `clientData: ClientData` (or the minimum fields needed — `ClientInfo` plus the incomes array so it can find existing SS rows).

Responsibilities:
- Render 1 or 2 summary rows based on `ClientInfo.spouseName` / `spouseDob` presence.
- Compute display values from the underlying SS rows (mode label, claim-age label, benefit preview).
- Open `SocialSecurityDialog` on row click.

### New component: `SocialSecurityDialog`

File: `src/components/social-security-dialog.tsx`.

Props: `owner: "client" | "spouse"`, `existingRow: Income | null`, `clientInfo: ClientInfo`, `planSettings: PlanSettings`, `onSave(...)`, `onClose()`.

Responsibilities:
- Render the focused form from the UX section above.
- Compute and display FRA + live preview using existing engine imports.
- POST new row or PUT existing row on save.

### Modified: `income-expenses-view.tsx`

- **Filter SS rows out** of the regular income list rendering.
- **Remove** `social_security` from the type dropdown in the add-income flow.
- **Delete** all SS-specific branching that Task 6 added to `IncomeDialog`: mode selector, PIA input, year+month claim-age pickers, FRA display, live preview, and the `submitAnnualAmount` preservation logic for SS. Non-SS paths are unaffected.
- **Mount** `<SocialSecurityCard ... />` below the income list.

### Modified API routes

- `src/app/api/clients/[id]/incomes/route.ts` (POST): extract and persist `claimingAgeMode` alongside the existing SS fields.
- `src/app/api/clients/[id]/incomes/[incomeId]/route.ts` (PUT): same — add `claimingAgeMode` to the allowlisted update fields.
- `src/app/api/clients/[id]/projection-data/route.ts`: forward `claimingAgeMode` in the income mapper so the engine receives it.

### Name field

The SS card's display always derives "[First Name]'s Social Security" from `ClientInfo` at render time. The row's stored `name` field is set on first save and never updated by the SS flow. The generic income list's rename affordance (if any) cannot reach SS rows because they're filtered out of that list.

## Migration

- One new drizzle migration adding `claiming_age_mode` (nullable text).
- No backfill needed — NULL maps to `"years"` in the engine.
- No deletion or reassignment of existing SS rows — they just start rendering in the new card.

## Testing Strategy

### Unit (vitest)

- `claimAge.test.ts` — new file. Covers:
  - `"fra"` mode resolves to `fraForBirthDate(dob).totalMonths` for client and spouse.
  - `"fra"` mode with missing DOB returns null.
  - `"at_retirement"` mode resolves to `retirementAge * 12` for client, `spouseRetirementAge * 12` for spouse.
  - `"at_retirement"` mode with missing `spouseRetirementAge` returns null.
  - `"years"` (and legacy null mode) resolves to `claimingAge * 12 + (claimingAgeMonths ?? 0)`.
  - Missing `claimingAge` with `"years"` mode returns null.
- `orchestrator.test.ts` extension — a few cases exercising each claim-age mode for sanity.
- `income.test.ts` extension — `no_benefit` short-circuit (returns 0); `claimingAgeMode: "fra"` flows through correctly.

### Integration (vitest)

- `projection.test.ts` extension — full-plan run using `"fra"` mode; verify the projection shifts correctly when the test DOB is moved (living-link invariant).

### Manual smoke

- Open the Income tab — see SS card at the bottom, 1 or 2 rows depending on the client.
- Click a row — focused dialog opens; correct defaults for new row vs. existing row.
- Save with `"fra"` mode — row persists; reopen shows FRA mode preserved.
- Save with `"at_retirement"` — change `retirementAge` elsewhere in the client profile; projection SS shifts to follow.
- Save with `no_benefit` — cashflow shows $0 SS for that person.
- Confirm SS rows no longer appear in the regular income list.
- Confirm the Add Income dropdown no longer shows "Social Security".

## Deferred

Everything previously deferred in [2026-04-19-social-security-design.md](./2026-04-19-social-security-design.md) remains deferred:

- Tier 3 (claiming optimizer UI)
- Tier 4 (PIA from wage history)
- Tier 5 (Exempt Pension / WEP, Max Family Benefit, child benefits, divorced-spouse, split-claim)
- Per-scenario death-year overrides (belongs to future Scenarios feature)

No new deferrals introduced by this redesign.
