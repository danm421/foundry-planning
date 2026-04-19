# Social Security UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate Social Security data entry to a dedicated Income-tab section with a focused edit dialog, and add "living link" claim-age modes (FRA / At Retirement) plus a `no_benefit` option — while keeping the existing Tier 1+2 engine math unchanged.

**Architecture:** The change is mostly additive on the engine side (one new `claimAge` resolver, one new `ssBenefitMode` value) and a UI swap on the presentation side (dedicated `SocialSecurityCard` + `SocialSecurityDialog` components; SS removed from the generic income flow). Existing engine and math modules are touched at three call sites that already compute claim-age inline.

**Tech Stack:** TypeScript, Next.js 16 App Router, drizzle-orm, vitest, React 19.

**Source spec:** [`docs/superpowers/specs/2026-04-19-social-security-redesign-design.md`](../specs/2026-04-19-social-security-redesign-design.md)

**Test command:** `npm test -- <path>` runs vitest in CI mode. Bare `npm test` runs all tests (currently 621 passing + 3 pre-existing timeline failures that are NOT from this branch).

---

## Task 1: Data model — claimingAgeMode column + no_benefit mode + API plumbing

**Files:**
- Modify: `src/engine/types.ts` (extend `Income.ssBenefitMode` union and add `claimingAgeMode`)
- Modify: `src/db/schema.ts` (add `claimingAgeMode` column to `incomes`)
- Create: `src/db/migrations/00XX_ss_claim_age_mode.sql` (drizzle generates, XX is the next number)
- Create: `src/db/migrations/meta/00XX_snapshot.json` (drizzle generates)
- Modify: `src/app/api/clients/[id]/incomes/route.ts` (POST — accept and persist `claimingAgeMode`)
- Modify: `src/app/api/clients/[id]/incomes/[incomeId]/route.ts` (PUT — same)
- Modify: `src/app/api/clients/[id]/projection-data/route.ts` (forward `claimingAgeMode` to engine)

- [ ] **Step 1: Extend the `Income` TS interface**

Edit `src/engine/types.ts`. Find the existing SS-specific fields (added in prior SS work — `ssBenefitMode`, `piaMonthly`, `claimingAgeMonths`). Update `ssBenefitMode` to include `"no_benefit"` and add `claimingAgeMode`:

```ts
  /** SS-specific. When unset, engine treats as "manual_amount" (legacy). */
  ssBenefitMode?: "manual_amount" | "pia_at_fra" | "no_benefit";
  /** SS-specific. Monthly PIA in today's dollars. Required when ssBenefitMode=pia_at_fra. */
  piaMonthly?: number;
  /** Additional months beyond `claimingAge` (0-11). Absent = 0. */
  claimingAgeMonths?: number;
  /** SS-specific. Resolves effective claim age at projection time.
   *  When unset, engine treats as "years" (legacy). */
  claimingAgeMode?: "years" | "fra" | "at_retirement";
```

- [ ] **Step 2: Add `claimingAgeMode` column to the drizzle schema**

Edit `src/db/schema.ts`. Find the `incomes` table definition (the SS columns `ssBenefitMode`, `piaMonthly`, `claimingAgeMonths` are already there from prior work). Add a new column right after `claimingAgeMonths`:

```ts
  claimingAgeMode: text("claiming_age_mode"),
```

- [ ] **Step 3: Generate the migration**

```bash
npx drizzle-kit generate --name ss_claim_age_mode
```

Expected output: creates a new migration file like `src/db/migrations/0035_ss_claim_age_mode.sql` plus `meta/0035_snapshot.json` and updates `_journal.json`. The generated SQL should be a single `ALTER TABLE "incomes" ADD COLUMN "claiming_age_mode" text;` — nothing else.

**If drizzle-kit generates extra DDL, stop and investigate.**

- [ ] **Step 4: Apply the migration**

```bash
npx drizzle-kit migrate
```

Expected: new migration applied, no errors. If the dev DB is shared with other worktrees (e.g., `monte-carlo-planning`) and drizzle-kit complains about tracking-table state, apply the ADD COLUMN manually with `ADD COLUMN IF NOT EXISTS "claiming_age_mode" text` against the DB and mark the migration as applied in `__drizzle_migrations`. Use the same reconciliation path that Task 1 of the original SS plan used — grep for prior patterns if needed.

- [ ] **Step 5: Persist `claimingAgeMode` in the POST handler**

Edit `src/app/api/clients/[id]/incomes/route.ts`. Find the existing POST handler and the drizzle `.values({})` insert call that already includes `ssBenefitMode`, `piaMonthly`, `claimingAgeMonths` (added in prior SS work). Add `claimingAgeMode`:

```ts
// In the .values({...}) object:
claimingAgeMode: body.claimingAgeMode ?? null,
```

Match the exact destructuring / allowlist pattern already in use for the other SS fields. Do not spread `body` directly.

- [ ] **Step 6: Persist `claimingAgeMode` in the PUT handler**

Edit `src/app/api/clients/[id]/incomes/[incomeId]/route.ts`. Find the existing conditional-spread pattern for `ssBenefitMode`, `piaMonthly`, `claimingAgeMonths` and add a matching entry:

```ts
...(body.claimingAgeMode !== undefined && { claimingAgeMode: body.claimingAgeMode }),
```

- [ ] **Step 7: Forward `claimingAgeMode` in the projection-data mapper**

Edit `src/app/api/clients/[id]/projection-data/route.ts`. Find the income mapper block that already forwards `ssBenefitMode`, `piaMonthly`, `claimingAgeMonths` to the engine (around lines 440-445 based on prior SS work). Add:

```ts
claimingAgeMode: (i.claimingAgeMode as "years" | "fra" | "at_retirement" | null) ?? undefined,
```

Match the conversion pattern used by neighboring fields (most stored text columns convert `null → undefined`).

- [ ] **Step 8: Run the full test suite**

```bash
npm test
```

Expected: 621 passing + 3 pre-existing timeline failures unchanged. Nothing should break since this is purely additive.

- [ ] **Step 9: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add src/engine/types.ts src/db/schema.ts src/db/migrations/ src/app/api/clients/
git commit -m "feat(ss): add claimingAgeMode column + no_benefit mode + API plumbing"
```

---

## Task 2: `resolveClaimAgeMonths` helper + tests (TDD)

**Files:**
- Create: `src/engine/socialSecurity/claimAge.ts`
- Create: `src/engine/socialSecurity/__tests__/claimAge.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/socialSecurity/__tests__/claimAge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveClaimAgeMonths } from "../claimAge";
import type { Income, ClientInfo } from "../../types";

function baseClient(overrides: Partial<ClientInfo> = {}): ClientInfo {
  return {
    firstName: "C",
    lastName: "L",
    dateOfBirth: "1960-06-01",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "single",
    ...overrides,
  };
}

function baseRow(overrides: Partial<Income> = {}): Income {
  return {
    id: "c",
    type: "social_security",
    name: "SS",
    annualAmount: 0,
    startYear: 2020,
    endYear: 2099,
    growthRate: 0,
    owner: "client",
    claimingAge: 67,
    ...overrides,
  };
}

describe("resolveClaimAgeMonths — 'years' mode", () => {
  it("returns claimingAge * 12 + claimingAgeMonths when both set", () => {
    const row = baseRow({ claimingAgeMode: "years", claimingAge: 66, claimingAgeMonths: 4 });
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(66 * 12 + 4);
  });
  it("treats unset claimingAgeMode as 'years' (legacy rows)", () => {
    const row = baseRow({ claimingAge: 67, claimingAgeMonths: 0 });
    // no claimingAgeMode set
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(67 * 12);
  });
  it("treats missing claimingAgeMonths as 0", () => {
    const row = baseRow({ claimingAgeMode: "years", claimingAge: 65 });
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(65 * 12);
  });
  it("returns null when claimingAge is unset in 'years' mode", () => {
    const row = baseRow({ claimingAgeMode: "years", claimingAge: undefined });
    expect(resolveClaimAgeMonths(row, baseClient())).toBeNull();
  });
});

describe("resolveClaimAgeMonths — 'fra' mode", () => {
  it("returns FRA totalMonths for client's DOB", () => {
    // Born 1960-06-01 → FRA 67y 0m = 804 months
    const row = baseRow({ claimingAgeMode: "fra", owner: "client" });
    expect(resolveClaimAgeMonths(row, baseClient())).toBe(804);
  });
  it("returns FRA totalMonths for spouse's DOB when owner is 'spouse'", () => {
    // Born 1956-08-01 → FRA 66y 4m = 796 months
    const row = baseRow({ claimingAgeMode: "fra", owner: "spouse" });
    const client = baseClient({ spouseDob: "1956-08-01" });
    expect(resolveClaimAgeMonths(row, client)).toBe(796);
  });
  it("returns null when DOB is missing (client)", () => {
    const row = baseRow({ claimingAgeMode: "fra", owner: "client" });
    const client = baseClient({ dateOfBirth: "" as string });
    expect(resolveClaimAgeMonths(row, client)).toBeNull();
  });
  it("returns null when spouse DOB is missing", () => {
    const row = baseRow({ claimingAgeMode: "fra", owner: "spouse" });
    const client = baseClient(); // no spouseDob
    expect(resolveClaimAgeMonths(row, client)).toBeNull();
  });
});

describe("resolveClaimAgeMonths — 'at_retirement' mode", () => {
  it("returns client retirementAge * 12", () => {
    const row = baseRow({ claimingAgeMode: "at_retirement", owner: "client" });
    expect(resolveClaimAgeMonths(row, baseClient({ retirementAge: 65 }))).toBe(65 * 12);
  });
  it("returns spouseRetirementAge * 12 when owner is 'spouse'", () => {
    const row = baseRow({ claimingAgeMode: "at_retirement", owner: "spouse" });
    const client = baseClient({ spouseDob: "1962-01-01", spouseRetirementAge: 63 });
    expect(resolveClaimAgeMonths(row, client)).toBe(63 * 12);
  });
  it("returns null when spouseRetirementAge is unset", () => {
    const row = baseRow({ claimingAgeMode: "at_retirement", owner: "spouse" });
    const client = baseClient({ spouseDob: "1962-01-01" }); // no spouseRetirementAge
    expect(resolveClaimAgeMonths(row, client)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- src/engine/socialSecurity/__tests__/claimAge.test.ts
```

Expected: module not found error.

- [ ] **Step 3: Implement the helper**

Create `src/engine/socialSecurity/claimAge.ts`:

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
 *
 * @param row  The SS income row. Uses `claimingAgeMode`, `claimingAge`, `claimingAgeMonths`, `owner`.
 * @param client  The household `ClientInfo`. Uses `dateOfBirth`, `spouseDob`, `retirementAge`, `spouseRetirementAge` depending on mode + owner.
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

  // "years" — existing behavior, including legacy rows where claimingAgeMode IS NULL
  if (row.claimingAge == null) return null;
  return row.claimingAge * 12 + (row.claimingAgeMonths ?? 0);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- src/engine/socialSecurity/__tests__/claimAge.test.ts
```

Expected: all tests pass (count them — there should be 11).

- [ ] **Step 5: Commit**

```bash
git add src/engine/socialSecurity/claimAge.ts src/engine/socialSecurity/__tests__/claimAge.test.ts
git commit -m "feat(ss): resolveClaimAgeMonths helper for FRA / At Retirement / years modes"
```

---

## Task 3: Wire resolver into engine + no_benefit short-circuit (TDD)

**Files:**
- Modify: `src/engine/income.ts`
- Modify: `src/engine/socialSecurity/orchestrator.ts`
- Modify: `src/engine/__tests__/income.test.ts` (extend with `no_benefit` + `claimingAgeMode: "fra"` tests)
- Modify: `src/engine/socialSecurity/__tests__/orchestrator.test.ts` (extend with living-link scenario)

- [ ] **Step 1: Write failing tests for `no_benefit` + `claimingAgeMode: "fra"` in income.ts**

Append to `src/engine/__tests__/income.test.ts`:

```ts
describe("computeIncome — SS no_benefit mode", () => {
  it("returns 0 for a no_benefit row regardless of PIA or annualAmount", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 30000,              // ignored
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 67,
      ssBenefitMode: "no_benefit",
      piaMonthly: 2000,                  // ignored
      inflationStartYear: 2022,
    };
    const result = computeIncome([ss], 2027, client); // age 67, claim met
    expect(result.socialSecurity).toBe(0);
    expect(result.bySource[ss.id]).toBeUndefined();
  });
});

describe("computeIncome — SS pia_at_fra with claimingAgeMode='fra'", () => {
  it("resolves claim age to FRA dynamically (67y for DOB 1960)", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 62,                   // should be ignored; mode is "fra"
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      claimingAgeMode: "fra",
      inflationStartYear: 2022,
    };
    // Client born 1960-06-01 → FRA 67y 0m. Year 2027 = age 67, just claimed.
    // At FRA, benefit = PIA unchanged = 24000/yr.
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(24000, 2);
  });

  it("returns 0 before FRA even if claimingAge year would have already fired", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 62,                   // ignored
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      claimingAgeMode: "fra",
      inflationStartYear: 2022,
    };
    // 2025: age 65 < FRA 67 → 0.
    expect(computeIncome([ss], 2025, client).socialSecurity).toBe(0);
  });
});
```

(Reuse the `client: ClientInfo` already declared at the top of the test file from the prior SS work — born 1960-06-01, FRA 67y 0m.)

- [ ] **Step 2: Run tests — expect failure**

```bash
npm test -- src/engine/__tests__/income.test.ts
```

Expected: the three new tests fail (income.ts doesn't know about `no_benefit` or the resolver yet — `no_benefit` falls through to manual path returning 30000, the fra-mode test returns 0 because `claimingAge=62` is before FRA).

- [ ] **Step 3: Modify `src/engine/income.ts`**

Add the import at the top of the file:

```ts
import { resolveClaimAgeMonths } from "./socialSecurity/claimAge";
```

Find the SS branch (after prior SS work it looks roughly like):

```ts
if (inc.type === "social_security" && inc.claimingAge != null) {
  // ...dead-spouse / dead-client guards...
  const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
  if (!ownerDob) continue;
  const birthYear = parseInt(ownerDob.slice(0, 4), 10);
  const claimingYear = birthYear + inc.claimingAge;
  if (year < claimingYear) continue;

  // pia_at_fra branch → orchestrator
  if (inc.ssBenefitMode === "pia_at_fra" && inc.piaMonthly != null) {
    // ...orchestrator call...
  }
}
```

Change the structure so:

(a) The `no_benefit` short-circuit is the very first check inside the SS branch:

```ts
if (inc.type === "social_security" && inc.claimingAge != null) {
  if (inc.ssBenefitMode === "no_benefit") continue;   // NEW
  // ...rest...
}
```

(b) The year-gate uses the resolved claim age, not `inc.claimingAge`:

Replace:
```ts
const birthYear = parseInt(ownerDob.slice(0, 4), 10);
const claimingYear = birthYear + inc.claimingAge;
if (year < claimingYear) continue;
```

With:
```ts
const claimAgeMonths = resolveClaimAgeMonths(inc, client);
if (claimAgeMonths == null) continue; // unresolvable mode (e.g., fra without DOB)
const birthYear = parseInt(ownerDob.slice(0, 4), 10);
if (year * 12 < birthYear * 12 + claimAgeMonths) continue;
```

Leave everything else (dead-spouse/dead-client guards, pia_at_fra branch calling `resolveAnnualBenefit`, the legacy manual_amount / undefined-mode fallthrough) unchanged.

- [ ] **Step 4: Run income.ts tests — expect pass**

```bash
npm test -- src/engine/__tests__/income.test.ts
```

Expected: all tests pass including the three new ones.

- [ ] **Step 5: Write failing test for orchestrator living-link**

Append to `src/engine/socialSecurity/__tests__/orchestrator.test.ts`:

```ts
describe("resolveAnnualBenefit — claimingAgeMode integration", () => {
  it("honors claimingAgeMode='fra' for this-spouse own benefit", () => {
    const client = ssIncome({
      id: "c",
      owner: "client",
      piaMonthly: 2000,
      claimingAge: 62,          // ignored when mode='fra'
      claimingAgeMode: "fra",
    });
    // baseClient DOB 1960-06-01 → FRA 67y = 804 months → first claim year 2027
    // In 2027, benefit should be FULL PIA (no early reduction), annualized
    const out = resolveAnnualBenefit({ row: client, spouseRow: null, client: { ...baseClient, spouseDob: undefined }, year: 2027 });
    expect(out.total).toBeCloseTo(2000 * 12, 2);
  });

  it("honors claimingAgeMode='at_retirement' for this-spouse own benefit", () => {
    const client = ssIncome({
      id: "c",
      owner: "client",
      piaMonthly: 2000,
      claimingAgeMode: "at_retirement",
    });
    // baseClient.retirementAge = 65 → 780 months → early reduction vs FRA 804 = 24 months
    // Reduction = 24 × 5/9% = 0.1333 → benefit = 2000 × 0.8667 = 1733.33/mo → 20800/yr
    const out = resolveAnnualBenefit({ row: client, spouseRow: null, client: { ...baseClient, spouseDob: undefined }, year: 2025 });
    expect(out.total).toBeCloseTo(2000 * (1 - 24 * (5 / 900)) * 12, 2);
  });
});
```

(Reuse `ssIncome` fixture and `baseClient` already in the file.)

- [ ] **Step 6: Run orchestrator tests — expect failure**

```bash
npm test -- src/engine/socialSecurity/__tests__/orchestrator.test.ts
```

Expected: the two new tests fail because the orchestrator still reads `claimingAge` + `claimingAgeMonths` inline.

- [ ] **Step 7: Modify `src/engine/socialSecurity/orchestrator.ts` to use the resolver**

Add import at the top:

```ts
import { resolveClaimAgeMonths } from "./claimAge";
```

Find three inline claim-age computations (they look like `(row.claimingAge ?? 0) * 12 + (row.claimingAgeMonths ?? 0)` or similar). Replace each with a call to `resolveClaimAgeMonths`:

1. **This spouse's claim-age months** (stored as `thisClaimAgeMonths` or similar):
```ts
const thisClaimAgeMonths = resolveClaimAgeMonths(input.row, input.client);
```
Handle the `null` case — if `null`, treat as "not yet claimed" (return `zero`):
```ts
if (thisClaimAgeMonths == null) return zero;
```

2. **Other spouse's claim-age months** (in the `otherHasClaimed` computation):
```ts
const otherClaimAgeMonths = resolveClaimAgeMonths(otherRow, input.client);
const otherHasClaimed = otherClaimAgeMonths != null && otherAgeMonthsThisYear >= otherClaimAgeMonths;
```

3. **Deceased's claim-age months** (in the Case A/B/D detection for survivor math):
```ts
const deceasedClaimAgeMonths = resolveClaimAgeMonths(otherRow, input.client) ?? 0;
// ... use deceasedClaimAgeMonths in `deceasedFiledBeforeFra` and in the computeOwnMonthlyBenefit call for the deceased's reduced benefit
```

For the `computeOwnMonthlyBenefit` call when computing the deceased's reduced benefit (the one that currently hardcodes `(otherRow.claimingAge ?? 0) * 12 + (otherRow.claimingAgeMonths ?? 0)`), pass `deceasedClaimAgeMonths` instead.

Everything else in `orchestrator.ts` stays the same — only the inline claim-age arithmetic is replaced.

- [ ] **Step 8: Run orchestrator tests — expect pass**

```bash
npm test -- src/engine/socialSecurity/__tests__/orchestrator.test.ts
```

Expected: all tests pass, including the two new claimingAgeMode tests AND every pre-existing test (the resolver is behaviorally equivalent to the inline math for `years` mode / null claimingAgeMode).

- [ ] **Step 9: Run the full test suite**

```bash
npm test
```

Expected: 621 prior + 11 (claimAge.test) + 3 (income.test `no_benefit` + 2 fra) + 2 (orchestrator fra/retirement) = 637 passing, plus the 3 pre-existing timeline failures. (If the count is off by ±1, don't panic — count the new tests you actually wrote and confirm no old ones regressed.)

- [ ] **Step 10: Commit**

```bash
git add src/engine/income.ts src/engine/socialSecurity/orchestrator.ts src/engine/__tests__/income.test.ts src/engine/socialSecurity/__tests__/orchestrator.test.ts
git commit -m "feat(ss): wire resolveClaimAgeMonths into engine + no_benefit short-circuit"
```

---

## Task 4: `SocialSecurityDialog` component

**Files:**
- Create: `src/components/social-security-dialog.tsx`

- [ ] **Step 1: Read existing dialog patterns**

Quick read to pattern-match:
```bash
grep -l "Dialog\|Modal" src/components/*.tsx | head -5
```

Look at one or two to see the existing style. In particular, skim `src/components/income-expenses-view.tsx` → the `IncomeDialog` function — the new SS dialog should follow the same Tailwind/Radix/form-submission style but with a much smaller field set. You are NOT reusing `IncomeDialog`; you are writing a fresh dialog component with the same visual patterns.

- [ ] **Step 2: Create the dialog**

Create `src/components/social-security-dialog.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { computeOwnMonthlyBenefit } from "@/engine/socialSecurity/ownRetirement";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";

type SsBenefitMode = "pia_at_fra" | "manual_amount" | "no_benefit";
type ClaimAgeMode = "fra" | "at_retirement" | "years";

export interface SocialSecurityDialogProps {
  clientId: string;
  owner: "client" | "spouse";
  existingRow: Income | null;
  clientInfo: ClientInfo;
  planSettings: PlanSettings;
  onClose: () => void;
  onSaved: () => void;  // parent re-fetches or re-renders
}

export function SocialSecurityDialog({
  clientId,
  owner,
  existingRow,
  clientInfo,
  planSettings,
  onClose,
  onSaved,
}: SocialSecurityDialogProps) {
  const firstName = owner === "spouse"
    ? (clientInfo.spouseName ?? "Spouse")
    : clientInfo.firstName;

  const ownerDob = owner === "spouse" ? clientInfo.spouseDob : clientInfo.dateOfBirth;
  const ownerRetirementAge = owner === "spouse" ? clientInfo.spouseRetirementAge : clientInfo.retirementAge;

  const currentYear = new Date().getFullYear();

  // ── State ────────────────────────────────────────────────
  const [ssBenefitMode, setSsBenefitMode] = useState<SsBenefitMode>(() => {
    const stored = existingRow?.ssBenefitMode;
    if (stored === "pia_at_fra" || stored === "manual_amount" || stored === "no_benefit") return stored;
    return existingRow ? "manual_amount" : "pia_at_fra";
  });

  const [piaMonthly, setPiaMonthly] = useState<string>(
    existingRow?.piaMonthly != null ? String(existingRow.piaMonthly) : ""
  );

  const [annualAmount, setAnnualAmount] = useState<string>(
    existingRow?.annualAmount != null ? String(existingRow.annualAmount) : ""
  );

  const [claimingAgeMode, setClaimingAgeMode] = useState<ClaimAgeMode>(() => {
    const stored = existingRow?.claimingAgeMode;
    if (stored === "years" || stored === "fra" || stored === "at_retirement") return stored;
    return existingRow ? "years" : "fra";
  });

  const [claimingAge, setClaimingAge] = useState<number>(existingRow?.claimingAge ?? 67);
  const [claimingAgeMonths, setClaimingAgeMonths] = useState<number>(existingRow?.claimingAgeMonths ?? 0);

  const [growthRate, setGrowthRate] = useState<string>(() => {
    if (existingRow?.growthRate != null) return String(existingRow.growthRate * 100);
    return String(planSettings.inflationRate * 100);
  });

  // ── Derived display ──────────────────────────────────────
  const fraDisplay = useMemo(() => {
    if (!ownerDob) return null;
    const fra = fraForBirthDate(ownerDob);
    return `Full Retirement Age: ${fra.years}y ${fra.months}mo (born ${ownerDob.slice(0, 4)})`;
  }, [ownerDob]);

  const preview = useMemo(() => {
    if (ssBenefitMode === "no_benefit") return null;
    const growthPct = parseFloat(growthRate) / 100 || 0;

    if (ssBenefitMode === "manual_amount") {
      const amount = parseFloat(annualAmount);
      if (isNaN(amount) || amount <= 0) return null;
      return Math.round(amount * Math.pow(1 + growthPct, 0));
    }

    // pia_at_fra
    const pia = parseFloat(piaMonthly);
    if (isNaN(pia) || pia <= 0 || !ownerDob) return null;

    const mockRow: Income = {
      id: "preview",
      type: "social_security",
      name: "",
      annualAmount: 0,
      startYear: currentYear,
      endYear: 2099,
      growthRate: 0,
      owner,
      claimingAge,
      claimingAgeMonths,
      claimingAgeMode,
      piaMonthly: pia,
      ssBenefitMode: "pia_at_fra",
    };
    const claimAgeMonthsResolved = resolveClaimAgeMonths(mockRow, clientInfo);
    if (claimAgeMonthsResolved == null) return null;

    const monthly = computeOwnMonthlyBenefit({
      piaMonthly: pia,
      claimAgeMonths: claimAgeMonthsResolved,
      dob: ownerDob,
    });
    return Math.round(monthly * 12);
  }, [ssBenefitMode, piaMonthly, annualAmount, growthRate, claimingAge, claimingAgeMonths, claimingAgeMode, ownerDob, owner, clientInfo, currentYear]);

  // ── Save ─────────────────────────────────────────────────
  async function handleSave() {
    const growthPct = parseFloat(growthRate) / 100 || 0;
    const pia = ssBenefitMode === "pia_at_fra" ? parseFloat(piaMonthly) || 0 : null;
    const annual = ssBenefitMode === "manual_amount"
      ? (parseFloat(annualAmount) || 0)
      : (existingRow?.annualAmount ?? 0);   // preserve or zero

    const payload = {
      type: "social_security",
      owner,
      name: existingRow?.name ?? `${firstName}'s Social Security`,
      annualAmount: annual,
      startYear: existingRow?.startYear ?? currentYear,
      endYear: existingRow?.endYear ?? 2099,
      growthRate: growthPct,
      inflationStartYear: existingRow?.inflationStartYear ?? currentYear,
      claimingAge: claimingAgeMode === "years" ? claimingAge : (existingRow?.claimingAge ?? claimingAge),
      claimingAgeMonths: claimingAgeMode === "years" ? claimingAgeMonths : (existingRow?.claimingAgeMonths ?? 0),
      claimingAgeMode,
      ssBenefitMode,
      piaMonthly: pia,
    };

    const url = existingRow
      ? `/api/clients/${clientId}/incomes/${existingRow.id}`
      : `/api/clients/${clientId}/incomes`;
    const method = existingRow ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      alert(`Save failed: ${text}`);
      return;
    }
    onSaved();
    onClose();
  }

  const fraDisabled = !ownerDob;
  const retirementDisabled = ownerRetirementAge == null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Edit {firstName}'s Social Security</h2>

        {fraDisplay && (
          <p className="text-xs text-slate-500 mb-4">{fraDisplay}</p>
        )}

        {/* Benefit mode */}
        <fieldset className="mb-4">
          <legend className="text-sm font-medium mb-2">Benefit mode</legend>
          <label className="block text-sm mb-1">
            <input type="radio" checked={ssBenefitMode === "pia_at_fra"} onChange={() => setSsBenefitMode("pia_at_fra")} className="mr-2" />
            Primary Insurance Amount (PIA)
          </label>
          <label className="block text-sm mb-1">
            <input type="radio" checked={ssBenefitMode === "manual_amount"} onChange={() => setSsBenefitMode("manual_amount")} className="mr-2" />
            Annual benefit amount
          </label>
          <label className="block text-sm mb-1">
            <input type="radio" checked={ssBenefitMode === "no_benefit"} onChange={() => setSsBenefitMode("no_benefit")} className="mr-2" />
            No Benefit
          </label>
        </fieldset>

        {/* Conditional amount input */}
        {ssBenefitMode === "pia_at_fra" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Monthly PIA</label>
            <input
              type="number"
              value={piaMonthly}
              onChange={(e) => setPiaMonthly(e.target.value)}
              placeholder="e.g. 2800"
              className="w-full border rounded px-2 py-1"
            />
            <p className="text-xs text-slate-500 mt-1">From your SSA statement — monthly benefit at FRA.</p>
          </div>
        )}
        {ssBenefitMode === "manual_amount" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Annual benefit amount</label>
            <input
              type="number"
              value={annualAmount}
              onChange={(e) => setAnnualAmount(e.target.value)}
              className="w-full border rounded px-2 py-1"
            />
          </div>
        )}
        {ssBenefitMode === "no_benefit" && (
          <p className="text-sm text-slate-500 italic mb-4">
            This person will receive no Social Security benefit in the projection.
          </p>
        )}

        {/* Claim age mode */}
        {ssBenefitMode !== "no_benefit" && (
          <fieldset className="mb-4">
            <legend className="text-sm font-medium mb-2">Claim age</legend>
            <label className="block text-sm mb-1" title={fraDisabled ? "Set date of birth to use FRA" : undefined}>
              <input
                type="radio"
                disabled={fraDisabled}
                checked={claimingAgeMode === "fra"}
                onChange={() => setClaimingAgeMode("fra")}
                className="mr-2"
              />
              Full Retirement Age
            </label>
            <label className="block text-sm mb-1" title={retirementDisabled ? "Set retirement age to use this option" : undefined}>
              <input
                type="radio"
                disabled={retirementDisabled}
                checked={claimingAgeMode === "at_retirement"}
                onChange={() => setClaimingAgeMode("at_retirement")}
                className="mr-2"
              />
              At Retirement{ownerRetirementAge != null ? ` (${ownerRetirementAge})` : ""}
            </label>
            <label className="block text-sm mb-1">
              <input
                type="radio"
                checked={claimingAgeMode === "years"}
                onChange={() => setClaimingAgeMode("years")}
                className="mr-2"
              />
              Specific Age
            </label>
            {claimingAgeMode === "years" && (
              <div className="flex gap-2 mt-2 ml-6">
                <select
                  value={claimingAge}
                  onChange={(e) => setClaimingAge(parseInt(e.target.value, 10))}
                  className="border rounded px-2 py-1"
                >
                  {[62, 63, 64, 65, 66, 67, 68, 69, 70].map((y) => (
                    <option key={y} value={y}>{y} years</option>
                  ))}
                </select>
                <select
                  value={claimingAgeMonths}
                  onChange={(e) => setClaimingAgeMonths(parseInt(e.target.value, 10))}
                  className="border rounded px-2 py-1"
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i}>{i} months</option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>
        )}

        {/* COLA */}
        {ssBenefitMode !== "no_benefit" && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Annual COLA %</label>
            <input
              type="number"
              step="0.1"
              value={growthRate}
              onChange={(e) => setGrowthRate(e.target.value)}
              className="w-32 border rounded px-2 py-1"
            />
          </div>
        )}

        {/* Preview */}
        {preview != null && (
          <p className="text-sm text-slate-600 mb-4">
            Estimated first-year benefit: ${preview.toLocaleString()}
          </p>
        )}

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 border rounded">Cancel</button>
          <button onClick={handleSave} className="px-3 py-1 bg-blue-600 text-white rounded">Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. If the imports for `ClientInfo`, `PlanSettings`, or the SS engine modules don't resolve with `@/engine/...`, swap to relative paths (`../engine/...`) to match the rest of the codebase.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: 637 passing + 3 pre-existing timeline failures. (The dialog is not yet mounted anywhere, so no runtime tests exercise it; just confirming no regression.)

- [ ] **Step 5: Commit**

```bash
git add src/components/social-security-dialog.tsx
git commit -m "feat(ss): SocialSecurityDialog component with living claim-age modes"
```

---

## Task 5: `SocialSecurityCard` + Income tab integration + cleanup

**Files:**
- Create: `src/components/social-security-card.tsx`
- Modify: `src/components/income-expenses-view.tsx` (remove SS branching, filter list, mount card, remove SS from type dropdown)

- [ ] **Step 1: Create the SS card component**

Create `src/components/social-security-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";
import { SocialSecurityDialog } from "./social-security-dialog";
import { fraForBirthDate } from "@/engine/socialSecurity/fra";
import { computeOwnMonthlyBenefit } from "@/engine/socialSecurity/ownRetirement";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";

export interface SocialSecurityCardProps {
  clientId: string;
  clientInfo: ClientInfo;
  planSettings: PlanSettings;
  incomes: Income[];
  onSaved: () => void;
}

function findRow(incomes: Income[], owner: "client" | "spouse"): Income | null {
  const rows = incomes.filter((i) => i.type === "social_security" && i.owner === owner);
  if (rows.length === 0) return null;
  // If multiple exist, take the first (legacy edge case, unlikely for test data)
  return rows[0];
}

function summaryLabel(row: Income | null, clientInfo: ClientInfo, owner: "client" | "spouse"): string {
  if (!row) return "— Not configured —";
  const mode = row.ssBenefitMode ?? "manual_amount";
  if (mode === "no_benefit") return "No Benefit";

  const modeLabel = mode === "pia_at_fra" ? "PIA" : "Annual";
  const claimLabel = claimAgeLabel(row, clientInfo, owner);
  const preview = previewAmount(row, clientInfo);
  const previewLabel = preview != null ? ` · $${preview.toLocaleString()}/yr est.` : "";
  return `${modeLabel} · ${claimLabel}${previewLabel}`;
}

function claimAgeLabel(row: Income, clientInfo: ClientInfo, owner: "client" | "spouse"): string {
  const mode = row.claimingAgeMode ?? "years";
  if (mode === "fra") {
    const dob = owner === "spouse" ? clientInfo.spouseDob : clientInfo.dateOfBirth;
    if (!dob) return "FRA";
    const fra = fraForBirthDate(dob);
    return `FRA (${fra.years}y ${fra.months}mo)`;
  }
  if (mode === "at_retirement") {
    const age = owner === "spouse" ? clientInfo.spouseRetirementAge : clientInfo.retirementAge;
    return age != null ? `At Retirement (${age})` : "At Retirement";
  }
  return `${row.claimingAge ?? 67}y ${row.claimingAgeMonths ?? 0}mo`;
}

function previewAmount(row: Income, clientInfo: ClientInfo): number | null {
  if (row.ssBenefitMode === "no_benefit") return null;
  if (row.ssBenefitMode === "manual_amount") return row.annualAmount || null;

  const dob = row.owner === "spouse" ? clientInfo.spouseDob : clientInfo.dateOfBirth;
  if (!dob || row.piaMonthly == null || row.piaMonthly <= 0) return null;
  const claimAgeMonths = resolveClaimAgeMonths(row, clientInfo);
  if (claimAgeMonths == null) return null;

  const monthly = computeOwnMonthlyBenefit({ piaMonthly: row.piaMonthly, claimAgeMonths, dob });
  return Math.round(monthly * 12);
}

export function SocialSecurityCard({ clientId, clientInfo, planSettings, incomes, onSaved }: SocialSecurityCardProps) {
  const [editing, setEditing] = useState<"client" | "spouse" | null>(null);

  const hasSpouse = Boolean(clientInfo.spouseName || clientInfo.spouseDob);
  const clientRow = findRow(incomes, "client");
  const spouseRow = hasSpouse ? findRow(incomes, "spouse") : null;

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold mb-2">Social Security</h3>
      <div className="border rounded divide-y">
        <button
          type="button"
          onClick={() => setEditing("client")}
          className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between"
        >
          <span className="text-sm">
            <span className="font-medium">{clientInfo.firstName}</span>
            <span className="text-slate-500 ml-2">{summaryLabel(clientRow, clientInfo, "client")}</span>
          </span>
          <span className="text-slate-400">›</span>
        </button>
        {hasSpouse && (
          <button
            type="button"
            onClick={() => setEditing("spouse")}
            className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between"
          >
            <span className="text-sm">
              <span className="font-medium">{clientInfo.spouseName ?? "Spouse"}</span>
              <span className="text-slate-500 ml-2">{summaryLabel(spouseRow, clientInfo, "spouse")}</span>
            </span>
            <span className="text-slate-400">›</span>
          </button>
        )}
      </div>

      {editing && (
        <SocialSecurityDialog
          clientId={clientId}
          owner={editing}
          existingRow={editing === "client" ? clientRow : spouseRow}
          clientInfo={clientInfo}
          planSettings={planSettings}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Filter SS rows out of the existing income list + remove SS from type dropdown**

Edit `src/components/income-expenses-view.tsx`. Make three distinct changes:

**(a)** Find the map/filter that renders the income list rows. Add a filter to exclude `type === "social_security"`. For example, if the code looks like `incomes.map((inc) => ...)`, change to `incomes.filter((inc) => inc.type !== "social_security").map(...)`.

**(b)** Find the type selector in the add-income flow (typically in `IncomeDialog` — a `<select>` with options like `salary`, `social_security`, `business`, etc.). Remove the `social_security` option entirely.

**(c)** Delete all SS-specific branching from `IncomeDialog` — the block added in the earlier SS work (mode selector, PIA input, year+month claim-age pickers, FRA display, live preview). Look for the conditional `isSocialSecurity` / `type === "social_security"` block and remove the SS-specific UI and state. Also remove:
- the `defaultSsMode` / `ssBenefitMode` state
- the `submitAnnualAmount` special-casing for pia_at_fra mode (revert to just reading `annualAmount` from FormData)
- related imports (`fraForBirthDate`, `computeOwnMonthlyBenefit`) if they are no longer used
- any `ssBenefitMode`, `piaMonthly`, `claimingAgeMonths` fields in the submit payload

The `claimingAge` field should stay — it's still used for non-SS incomes... wait, check if `claimingAge` is referenced for any non-SS type. If not, it can also go. Grep in the file. If unsure, leave it — dead code is cheaper than broken code.

**(d)** Import and mount the new card. Near the top:

```tsx
import { SocialSecurityCard } from "./social-security-card";
```

Near the bottom of the income tab JSX (below the existing income list), add:

```tsx
<SocialSecurityCard
  clientId={clientId}
  clientInfo={clientInfo}
  planSettings={planSettings}
  incomes={incomes}
  onSaved={onIncomesChanged}   // whatever the existing refresh prop is called
/>
```

Look at the existing component props to find the right refresh/reload callback name. If there isn't one, see how the existing income add/edit form triggers a refresh (probably a `router.refresh()` call or similar) and use the same mechanism.

- [ ] **Step 3: Run type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. Cleanup may leave unused imports in `income-expenses-view.tsx` — TypeScript will complain. Remove them.

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: 637 passing, 3 pre-existing timeline failures. No regressions.

- [ ] **Step 5: Manual browser smoke test**

Start the dev server if it isn't already running:
```bash
npm run dev
```

In the browser:
1. Navigate to a client's Income tab → confirm the main income list no longer shows SS rows, and the Add Income type dropdown no longer has "Social Security".
2. Below the income list → confirm a "Social Security" card with 1 or 2 rows.
3. Click the client's row → SS dialog opens. For a fresh client, it should default to `pia_at_fra` mode + `fra` claim-age mode.
4. Enter PIA 2800 → preview updates to ~$33,600/yr at FRA.
5. Switch to Annual benefit amount → PIA field hides, annual field appears.
6. Switch to No Benefit → amount fields hide, gray message appears.
7. Save with pia_at_fra + FRA. Reopen → all values preserved correctly.
8. On a married client, confirm both rows appear. Edit spouse row → header says "Edit [Spouse Name]'s Social Security".
9. In the cashflow report, confirm the SS row still drills down into per-spouse breakdown (this was Task 12 of the original SS plan — unchanged).

If you cannot run the dev server, skip this step and flag for the controller to perform manually.

- [ ] **Step 6: Commit**

```bash
git add src/components/social-security-card.tsx src/components/income-expenses-view.tsx
git commit -m "feat(ss): dedicated Social Security card replaces generic income flow"
```

---

## Task 6: E2E living-link verification + final build

**Files:**
- Modify: `src/engine/__tests__/projection.test.ts` (add one living-link scenario)

- [ ] **Step 1: Add a living-link integration test**

Append to `src/engine/__tests__/projection.test.ts`:

```ts
describe("projection — SS living-link claim-age modes", () => {
  it("claim age follows client DOB when using claimingAgeMode='fra'", () => {
    // Scenario: client born 1960-06-01 (FRA 67y 0m → 2027 first claim year)
    // piaMonthly = 2000, mode = pia_at_fra + claimingAgeMode = "fra"
    // 2026 (age 66): no claim → $0
    // 2027 (age 67): FRA claim → $24,000
    // (Construct the minimal ClientData using the existing fixtures pattern in this file — 
    //  mirror the Task 11/13 tests at the top of the describe block if those already build one.)

    // Run the projection and assert both year values.
    // Use existing `runProjection` or whatever the top-level test driver is.
    // Leave the fixture construction to match the existing pattern; there is no 
    // new code to invent here — just plug "fra" into an existing ssIncome-style helper.
  });
});
```

Write the concrete assertions using the existing `runProjection` (or equivalent) and fixture builders already in the test file. If there are no helpers to reuse, inline a minimal `ClientData` object — similar clients/plans exist in the current test file. Actual values should be 0 for 2026, ~24000 for 2027.

- [ ] **Step 2: Run projection.test.ts — expect pass**

```bash
npm test -- src/engine/__tests__/projection.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: 638 passing + 3 pre-existing timeline failures.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: no new errors from our touched files. Pre-existing lint warnings/errors in files we didn't touch are not our concern.

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: successful build.

- [ ] **Step 7: Commit + push**

```bash
git add src/engine/__tests__/projection.test.ts
git commit -m "test(ss): living-link claim-age mode projection scenario"
git push
```

If this branch has already been pushed, `git push` will update the remote with the new commits from the redesign. The PR (if already opened) will update automatically.

---

## Notes

- **Regression invariant:** Every change in Tasks 1-3 is either purely additive (new column, new mode enum value, new helper) or behaviorally equivalent for legacy data (the resolver's "years" default branch is mathematically identical to the code it replaces). If any pre-existing test breaks in Tasks 1-3, STOP — something is wrong.

- **Dead-spouse / dead-client guards** added in the original SS Task 13 must remain intact in `income.ts`. They live above the `no_benefit` short-circuit added here. Do not move or remove them.

- **Cashflow report drill-down** from original SS Task 12 is NOT touched here. It keeps working automatically because `socialSecurityDetail` is populated from the orchestrator's output, which now just uses the resolver but emits the same shape.

- **Manual smoke test** is the only way to verify the UI works end-to-end. Tasks 4 and 5 each ask the implementer to run one. If they cannot (no browser), the controller must run them manually before declaring the feature shipped.

- **No new FUTURE_WORK.md entries** expected from this redesign — all existing deferrals (Tier 3/4/5) remain.
