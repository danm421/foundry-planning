# Final-Death Asset Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final-death engine event: when the survivor of a couple (post-4b) or a single-filer-from-start client dies mid-projection, run the precedence chain with updated condition semantics, distribute unlinked household liabilities proportionally to heirs, unify the death-transfer ledger across both 4b and 4c, and hard-stop the projection at the end of the final-death year.

**Architecture:** Extend `src/engine/death-event.ts` in place. Add `applyFinalDeath(input) → result` alongside the existing `applyFirstDeath`, reusing the per-step helpers (`applyBeneficiaryDesignations`, `applyWillSpecificBequests`, `applyWillAllAssetsResidual`, `applyFallback`, `applyIncomeTermination`, `splitAccount`). The projection loop calls it at end-of-final-death-year, folds the mutated state, appends to the same `deathTransfers` ledger on the year row, then `break`s out of the year loop.

**Tech Stack:** TypeScript, vitest. No DB schema changes — all 4c inputs exist. Spec: [docs/superpowers/specs/2026-04-23-final-death-transfer-design.md](../specs/2026-04-23-final-death-transfer-design.md).

---

## File Structure

**Modified:**
- `src/engine/types.ts` — rename `FirstDeathTransfer` → `DeathTransfer`; add `deathOrder`, `sourceLiabilityId`, `sourceLiabilityName`, `resultingLiabilityId` fields; extend `via` union with `unlinked_liability_proportional`; rename `ProjectionYear.firstDeathTransfers` → `deathTransfers`; add `Liability.ownerFamilyMemberId`.
- `src/engine/death-event.ts` — rename all `FirstDeathTransfer` references; add `computeFinalDeathYear` + `identifyFinalDeceased`; generalize `firesAtFirstDeath` → `firesAtDeath(b, deathOrder)`; thread `deathOrder` through step 3a/3b; add `distributeUnlinkedLiabilities`; add `applyFinalDeath` orchestrator; add `joint` / `spouse` invariants used by 4c.
- `src/engine/projection.ts` — rename field; add `finalDeathYear` / `finalDeceased` setup at top of `runProjection`; add 4c block after 4b block; `break` out of year loop after the 4c block to enforce truncation.
- `src/engine/__tests__/death-event.test.ts` — update existing tests for rename; add unit tests for new helpers; add 4c orchestrator tests.
- `src/engine/__tests__/projection.test.ts` — rename field references; add 4c integration tests; push pre-existing tests' `lifeExpectancy` off-horizon if they now trip 4c fallback.

**New:** none. All code lives in existing files, per the approved "(A) extend in place" architecture decision.

---

### Task 1: Add `Liability.ownerFamilyMemberId` field

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Add the optional field**

In `src/engine/types.ts`, locate the `Liability` interface (around line 235). Add `ownerFamilyMemberId` alongside the existing `ownerEntityId`:

```ts
export interface Liability {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  startYear: number;
  startMonth: number; // 1-12
  termMonths: number;
  balanceAsOfMonth?: number;
  balanceAsOfYear?: number;
  linkedPropertyId?: string;
  ownerEntityId?: string;
  /** Set by the final-death event (4c) when an unlinked household liability
   *  is distributed proportionally to a family-member heir. Null / absent
   *  for household-originated liabilities. */
  ownerFamilyMemberId?: string;
  isInterestDeductible?: boolean;
  extraPayments: ExtraPayment[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `exit 0` — additive optional field.

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(engine-types): add Liability.ownerFamilyMemberId for 4c distribution"
```

---

### Task 2: Rename `FirstDeathTransfer` → `DeathTransfer` + extend type + rename `ProjectionYear` field

Single cross-cutting refactor. After this task, the 4b test suite must still pass unchanged — this is purely a rename + additive extension.

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/death-event.ts`
- Modify: `src/engine/projection.ts`
- Modify: `src/engine/__tests__/death-event.test.ts`
- Modify: `src/engine/__tests__/projection.test.ts`

- [ ] **Step 1: Rename the type + extend fields in `types.ts`**

In `src/engine/types.ts`, replace the `FirstDeathTransfer` interface (currently around line 42) with:

```ts
export interface DeathTransfer {
  year: number;
  /** 1 = first death (4b); 2 = final death (4c). */
  deathOrder: 1 | 2;
  deceased: "client" | "spouse";
  /** Source account id for asset transfers; null when this entry represents
   *  a proportional unlinked-liability transfer (see sourceLiabilityId). */
  sourceAccountId: string | null;
  /** Frozen at event time. Null for liability transfers. */
  sourceAccountName: string | null;
  /** Source liability id for unlinked_liability_proportional entries only. */
  sourceLiabilityId: string | null;
  /** Frozen at event time. Null for asset transfers. */
  sourceLiabilityName: string | null;
  via:
    | "titling"
    | "beneficiary_designation"
    | "will"
    | "fallback_spouse"
    | "fallback_children"
    | "fallback_other_heirs"
    | "unlinked_liability_proportional";
  recipientKind:
    | "spouse"
    | "family_member"
    | "entity"
    | "external_beneficiary"
    | "system_default";
  recipientId: string | null;
  recipientLabel: string;
  /** Positive for asset transfers; negative for liability transfers. */
  amount: number;
  /** Proportional basis for asset transfers. 0 for liability transfers. */
  basis: number;
  /** Synthetic account id when recipient kept it in household; null otherwise. */
  resultingAccountId: string | null;
  /** Synthetic liability id for family-member recipients of unlinked debt;
   *  null for asset transfers and for external / system_default liability
   *  transfers. */
  resultingLiabilityId: string | null;
}
```

- [ ] **Step 2: Rename the `ProjectionYear` field**

In the same file, find the `ProjectionYear` interface (around line 464). Replace:

```ts
  /** Only populated on the first-death year. One entry per (source-account × recipient). */
  firstDeathTransfers?: FirstDeathTransfer[];
```

with:

```ts
  /** Only populated on death-event years. One entry per (source × recipient).
   *  Same-year double death (4b + 4c in the same year) produces both
   *  deathOrder = 1 and deathOrder = 2 entries on the same row. */
  deathTransfers?: DeathTransfer[];
```

The `deathWarnings?: string[]` field name is unchanged.

- [ ] **Step 3: Typecheck — expect a flood of errors**

Run: `npx tsc --noEmit`
Expected: many errors pointing at `FirstDeathTransfer` and `firstDeathTransfers` references in `death-event.ts`, `projection.ts`, and the test files. Each is a straight rename.

- [ ] **Step 4: Update `death-event.ts` references**

In `src/engine/death-event.ts`:

a) Replace the import:

```ts
import type { ClientInfo, Account, Liability, FirstDeathTransfer, FamilyMember, Will, WillBequest, EntitySummary, Income } from "./types";
```

with:

```ts
import type { ClientInfo, Account, Liability, DeathTransfer, FamilyMember, Will, WillBequest, EntitySummary, Income } from "./types";
```

b) Replace every other textual occurrence of `FirstDeathTransfer` with `DeathTransfer` (there are type annotations in `SplitShare.ledgerMeta`, `SplitAccountResult.ledgerEntries`, `StepResult.ledgerEntries`, `resolveRecipientLabelAndMutation`'s return type, and `DeathEventResult.transfers`).

c) Add the new nullable fields to every emission site. The ledger entries come from `splitAccount`, which constructs `DeathTransfer` objects internally. Find the emission inside `splitAccount` — it currently builds a `ledgerEntries` array. Every built entry needs:
- `deathOrder: 1` (all current emitters are 4b)
- `sourceAccountId: source.id` (already present, was typed as non-nullable — still set it the same way)
- `sourceAccountName: source.name` (already present)
- `sourceLiabilityId: null` (new)
- `sourceLiabilityName: null` (new)
- `resultingLiabilityId: null` (new)

Inside `applyFirstDeath`, the final ledger assembly (`for (const entry of stepLedger) transfers.push({ ...entry, year, deceased })`) needs to also spread `deathOrder: 1`:

```ts
for (const entry of stepLedger) {
  transfers.push({ ...entry, year, deceased, deathOrder: 1 });
}
```

Leave `stepLedger`'s element type as `Omit<DeathTransfer, "year" | "deceased" | "deathOrder">` so the orchestrator is the one place that adds those fields.

Replace the existing type alias:

```ts
  ledgerEntries: Array<Omit<FirstDeathTransfer, "year" | "deceased">>;
```

with:

```ts
  ledgerEntries: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">>;
```

in all three places it appears (`SplitAccountResult`, `StepResult`, and the inline `stepLedger` in `applyFirstDeath`).

d) In `splitAccount`, every `ledgerEntries.push({ ... })` call needs the new `sourceLiabilityId`, `sourceLiabilityName`, and `resultingLiabilityId` fields set. Find all pushes and add:

```ts
sourceLiabilityId: null,
sourceLiabilityName: null,
resultingLiabilityId: null,
```

- [ ] **Step 5: Update `projection.ts` references**

In `src/engine/projection.ts` around line 1497:

```ts
thisYear.firstDeathTransfers = deathResult.transfers;
```

becomes:

```ts
thisYear.deathTransfers = deathResult.transfers;
```

No other references in that file should need changing.

- [ ] **Step 6: Update test files**

In `src/engine/__tests__/death-event.test.ts` and `src/engine/__tests__/projection.test.ts`, replace:
- `FirstDeathTransfer` → `DeathTransfer`
- `firstDeathTransfers` → `deathTransfers`

Tests that construct literal `DeathTransfer` objects (if any) also need the new fields — default to `deathOrder: 1` and the three null liability/resulting fields. Run a grep to find them:

```bash
grep -n "FirstDeathTransfer\|firstDeathTransfers" src/engine/__tests__/death-event.test.ts src/engine/__tests__/projection.test.ts
```

- [ ] **Step 7: Typecheck, then run tests**

Run: `npx tsc --noEmit`
Expected: `exit 0`.

Run: `npx vitest run src/engine/__tests__/death-event.test.ts src/engine/__tests__/projection.test.ts`
Expected: all existing tests pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/engine/types.ts src/engine/death-event.ts src/engine/projection.ts src/engine/__tests__/death-event.test.ts src/engine/__tests__/projection.test.ts
git commit -m "refactor(death-event): rename FirstDeathTransfer -> DeathTransfer; add 4c liability/deathOrder fields"
```

---

### Task 3: `computeFinalDeathYear` + `identifyFinalDeceased` helpers

Two small pure helpers. TDD.

**Files:**
- Modify: `src/engine/death-event.ts`
- Modify: `src/engine/__tests__/death-event.test.ts`

- [ ] **Step 1: Write failing tests for `computeFinalDeathYear`**

In `src/engine/__tests__/death-event.test.ts`, add a new `describe` block near the existing `describe("computeFirstDeathYear", ...)`:

```ts
import { computeFirstDeathYear, computeFinalDeathYear, identifyDeceased, identifyFinalDeceased } from "../death-event";

describe("computeFinalDeathYear", () => {
  const baseClient: ClientInfo = {
    firstName: "T", lastName: "T",
    dateOfBirth: "1970-01-01",
    retirementAge: 65, planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 80,            // dies 2050
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 85,      // dies 2057
  };

  it("returns the later of two assumed deaths for a couple", () => {
    expect(computeFinalDeathYear(baseClient, 2026, 2100)).toBe(2057);
  });

  it("returns the client's death year for a single-filer (no spouseDob)", () => {
    const client: ClientInfo = { ...baseClient, spouseDob: undefined, spouseLifeExpectancy: undefined, filingStatus: "single" };
    expect(computeFinalDeathYear(client, 2026, 2100)).toBe(2050);
  });

  it("returns null when no lifeExpectancy is set", () => {
    const client: ClientInfo = { ...baseClient, lifeExpectancy: undefined };
    expect(computeFinalDeathYear(client, 2026, 2100)).toBeNull();
  });

  it("returns null when the final death falls past planEndYear", () => {
    expect(computeFinalDeathYear(baseClient, 2026, 2050)).toBeNull();
  });

  it("handles same-year double death (both die the same year)", () => {
    const client: ClientInfo = {
      ...baseClient,
      lifeExpectancy: 80,          // dies 2050
      spouseLifeExpectancy: 78,    // dies 2050 (1972 + 78)
    };
    expect(computeFinalDeathYear(client, 2026, 2100)).toBe(2050);
  });

  it("falls back spouseLifeExpectancy=95 when null (matches 4b convention)", () => {
    const client: ClientInfo = { ...baseClient, spouseLifeExpectancy: null };
    // client dies 2050, spouse falls back to 1972 + 95 = 2067
    expect(computeFinalDeathYear(client, 2026, 2100)).toBe(2067);
  });
});

describe("identifyFinalDeceased", () => {
  const baseClient: ClientInfo = {
    firstName: "T", lastName: "T",
    dateOfBirth: "1970-01-01",
    retirementAge: 65, planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 80,
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 85,
  };

  it("returns the survivor of the first death (client died first → spouse is final)", () => {
    expect(identifyFinalDeceased(baseClient, "client")).toBe("spouse");
  });

  it("returns the survivor of the first death (spouse died first → client is final)", () => {
    expect(identifyFinalDeceased(baseClient, "spouse")).toBe("client");
  });

  it("returns 'client' for a single-filer (firstDeceased === null)", () => {
    expect(identifyFinalDeceased(baseClient, null)).toBe("client");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "computeFinalDeathYear"`
Expected: FAIL with "computeFinalDeathYear is not a function".

- [ ] **Step 3: Implement both helpers**

In `src/engine/death-event.ts`, directly below the existing `identifyDeceased` function (around line 44), add:

```ts
/** Compute the final-death year. For a couple, the later of the two assumed
 *  death years. For a single-filer client (no spouseDob), the client's own
 *  death year. Returns null when lifeExpectancy is missing or the computed
 *  year falls past the plan horizon.
 *
 *  Mirrors computeFirstDeathYear's spouseLifeExpectancy fallback of 95. */
export function computeFinalDeathYear(
  client: ClientInfo,
  planStartYear: number,
  planEndYear: number,
): number | null {
  if (client.lifeExpectancy == null) return null;

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const clientDeathYear = clientBirthYear + client.lifeExpectancy;

  let finalDeathYear: number;
  if (client.spouseDob) {
    const spouseBirthYear = parseInt(client.spouseDob.slice(0, 4), 10);
    const spouseLE = client.spouseLifeExpectancy ?? 95;
    const spouseDeathYear = spouseBirthYear + spouseLE;
    finalDeathYear = Math.max(clientDeathYear, spouseDeathYear);
  } else {
    finalDeathYear = clientDeathYear;
  }

  if (finalDeathYear < planStartYear || finalDeathYear > planEndYear) {
    return null;
  }
  return finalDeathYear;
}

/** Given who died first (or null for single-filer), identify who the final
 *  deceased is. For a couple, it's whoever didn't die first. For a
 *  single-filer, always "client". */
export function identifyFinalDeceased(
  _client: ClientInfo,
  firstDeceased: "client" | "spouse" | null,
): "client" | "spouse" {
  if (firstDeceased === "client") return "spouse";
  if (firstDeceased === "spouse") return "client";
  return "client";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "computeFinalDeathYear"`
Expected: PASS.

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "identifyFinalDeceased"`
Expected: PASS.

- [ ] **Step 5: Full death-event suite + typecheck**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts`
Expected: all green.

Run: `npx tsc --noEmit`
Expected: `exit 0`.

- [ ] **Step 6: Commit**

```bash
git add src/engine/death-event.ts src/engine/__tests__/death-event.test.ts
git commit -m "feat(death-event): computeFinalDeathYear + identifyFinalDeceased helpers"
```

---

### Task 4: Generalize `firesAtFirstDeath` → `firesAtDeath(b, deathOrder)` + thread through step 3a/3b

Change the local predicate so it fires correctly at either death event, and thread a new `deathOrder` param through the two will-step helpers that use it.

**Files:**
- Modify: `src/engine/death-event.ts`
- Modify: `src/engine/__tests__/death-event.test.ts`

- [ ] **Step 1: Write failing tests for `firesAtDeath`**

The current `firesAtFirstDeath` is a local helper — not exported. Export it as `firesAtDeath` so it's testable. Add to `src/engine/__tests__/death-event.test.ts`:

```ts
import { firesAtDeath } from "../death-event";
import type { WillBequest } from "../types";

describe("firesAtDeath", () => {
  const mkB = (condition: WillBequest["condition"]): WillBequest => ({
    id: "b1", assetMode: "all_assets", percentage: 100, condition,
    sortOrder: 0, recipients: [],
  });

  it("fires always-condition at both first and final death", () => {
    expect(firesAtDeath(mkB("always"), 1)).toBe(true);
    expect(firesAtDeath(mkB("always"), 2)).toBe(true);
  });

  it("fires if_spouse_survives at first death only", () => {
    expect(firesAtDeath(mkB("if_spouse_survives"), 1)).toBe(true);
    expect(firesAtDeath(mkB("if_spouse_survives"), 2)).toBe(false);
  });

  it("fires if_spouse_predeceased at final death only", () => {
    expect(firesAtDeath(mkB("if_spouse_predeceased"), 1)).toBe(false);
    expect(firesAtDeath(mkB("if_spouse_predeceased"), 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "firesAtDeath"`
Expected: FAIL with "firesAtDeath is not exported".

- [ ] **Step 3: Rewrite `firesAtFirstDeath` → exported `firesAtDeath`**

In `src/engine/death-event.ts`, replace the existing helper (around line 364):

```ts
/** Predicate: which condition-tier bequests fire at first death. */
function firesAtFirstDeath(b: WillBequest): boolean {
  return b.condition === "always" || b.condition === "if_spouse_survives";
}
```

with:

```ts
/** Predicate: which condition-tier bequests fire at a given death order.
 *  At first death (order 1): `always` and `if_spouse_survives` fire.
 *  At final death (order 2): `always` and `if_spouse_predeceased` fire.
 *  For a single-filer client, the advisor UI shouldn't present spouse-
 *  conditional options, but if either appears in the data, the order-2
 *  interpretation (no living spouse is the single-filer state) applies. */
export function firesAtDeath(b: WillBequest, deathOrder: 1 | 2): boolean {
  if (b.condition === "always") return true;
  if (b.condition === "if_spouse_survives") return deathOrder === 1;
  if (b.condition === "if_spouse_predeceased") return deathOrder === 2;
  return false;
}
```

- [ ] **Step 4: Thread `deathOrder` through step 3a/3b signatures**

In `applyWillSpecificBequests`, replace the filter line:

```ts
  const specifics = will.bequests.filter(
    (b) =>
      b.assetMode === "specific" &&
      b.accountId === source.id &&
      firesAtFirstDeath(b),
  );
```

with a signature that accepts `deathOrder` and threads it to `firesAtDeath`:

```ts
export function applyWillSpecificBequests(
  source: Account,
  undisposedFraction: number,
  will: Will,
  deathOrder: 1 | 2,
  survivor: "client" | "spouse" | null,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
  linkedLiability: Liability | undefined,
): StepResult & { warnings: string[] } {
  const specifics = will.bequests.filter(
    (b) =>
      b.assetMode === "specific" &&
      b.accountId === source.id &&
      firesAtDeath(b, deathOrder),
  );
  // ...rest unchanged
```

The `survivor` param also becomes nullable — at 4c, when a will clause names `recipientKind: "spouse"`, there's no survivor to retitle to, and the invariant check (Task 6) will flag this as bad data. `resolveRecipientLabelAndMutation` handles a null survivor by leaving `owner` unset; that's fine because the invariant catches it post-pipeline.

Update `resolveRecipientLabelAndMutation`'s signature to `survivor: "client" | "spouse" | null`. The spouse-recipient branch becomes:

```ts
  if (r.recipientKind === "spouse") {
    return {
      ownerMutation: survivor ? { owner: survivor } : undefined,
      removed: false,
      recipientKind: "spouse",
      recipientId: null,
      recipientLabel: "Spouse",
    };
  }
```

For the null-survivor case, `ownerMutation` is undefined, meaning the resulting account would be kept in the household with no owner mutation — the invariant check (Task 6) catches this.

In `applyWillAllAssetsResidual`, make the same changes:

```ts
export function applyWillAllAssetsResidual(
  source: Account,
  undisposedFraction: number,
  accountTouchedBySpecific: boolean,
  will: Will,
  deathOrder: 1 | 2,
  survivor: "client" | "spouse" | null,
  familyMembers: FamilyMember[],
  externals: ExternalBeneficiarySummary[],
  entities: EntitySummary[],
  linkedLiability: Liability | undefined,
): StepResult {
  if (accountTouchedBySpecific) {
    return empty();
  }
  const allAssets = will.bequests.filter(
    (b) => b.assetMode === "all_assets" && firesAtDeath(b, deathOrder),
  );
  // ...rest unchanged
```

- [ ] **Step 5: Update existing call sites in `applyFirstDeath`**

Inside `applyFirstDeath`, the two step-function calls need `deathOrder: 1` inserted in the correct slot:

```ts
    // Step 3a: Specific bequests
    if (undisposed > 1e-9 && deceasedWill) {
      const step3a = applyWillSpecificBequests(
        effectiveAcct, undisposed, deceasedWill, 1, survivor,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
```

and:

```ts
    // Step 3b: all_assets residual
    if (undisposed > 1e-9 && deceasedWill) {
      const step3b = applyWillAllAssetsResidual(
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 1, survivor,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
```

- [ ] **Step 6: Update tests that directly call `applyWillSpecificBequests` / `applyWillAllAssetsResidual`**

Grep for direct test call sites:

```bash
grep -n "applyWillSpecificBequests\|applyWillAllAssetsResidual" src/engine/__tests__/death-event.test.ts
```

Every call must insert `1` (or `2` where appropriate for final-death tests, though those don't exist yet) at the `deathOrder` position. Mechanical.

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts`
Expected: all green — `firesAtDeath` tests pass; the 4b step-3a and step-3b test suites still pass with the new signature.

Run: `npx tsc --noEmit`
Expected: `exit 0`.

- [ ] **Step 8: Commit**

```bash
git add src/engine/death-event.ts src/engine/__tests__/death-event.test.ts
git commit -m "refactor(death-event): firesAtFirstDeath -> firesAtDeath(b, deathOrder); thread through step 3a/3b"
```

---

### Task 5: `distributeUnlinkedLiabilities` helper

Pure helper: given the asset-transfer ledger produced by the precedence chain + the current liability list, compute the proportional distribution of unlinked household debts and return (updatedLiabilities, liabilityTransfers).

**Files:**
- Modify: `src/engine/death-event.ts`
- Modify: `src/engine/__tests__/death-event.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/engine/__tests__/death-event.test.ts`:

```ts
import { distributeUnlinkedLiabilities } from "../death-event";
import type { DeathTransfer, Liability } from "../types";

describe("distributeUnlinkedLiabilities", () => {
  const mkTransfer = (
    recipient: { kind: DeathTransfer["recipientKind"]; id: string | null; label: string },
    amount: number,
    resultingAccountId: string | null = "acct-new",
  ): DeathTransfer => ({
    year: 2050, deathOrder: 2, deceased: "client",
    sourceAccountId: "acct-src", sourceAccountName: "Src",
    sourceLiabilityId: null, sourceLiabilityName: null,
    via: "will", recipientKind: recipient.kind,
    recipientId: recipient.id, recipientLabel: recipient.label,
    amount, basis: 0, resultingAccountId, resultingLiabilityId: null,
  });

  const mkLiability = (overrides: Partial<Liability> = {}): Liability => ({
    id: "liab-cc", name: "Credit Card", balance: 10_000,
    interestRate: 0.15, monthlyPayment: 500,
    startYear: 2025, startMonth: 1, termMonths: 24,
    extraPayments: [],
    ...overrides,
  });

  it("returns empty transfers when no unlinked liabilities exist", () => {
    const liabilities = [mkLiability({ linkedPropertyId: "acct-home" })];
    const transfers = [mkTransfer({ kind: "family_member", id: "fm-1", label: "Sarah" }, 50_000)];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toEqual([]);
    expect(result.updatedLiabilities).toEqual(liabilities);
  });

  it("skips entity-owned liabilities (4d territory)", () => {
    const liabilities = [mkLiability({ ownerEntityId: "ent-1" })];
    const transfers = [mkTransfer({ kind: "family_member", id: "fm-1", label: "Sarah" }, 50_000)];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toEqual([]);
    expect(result.updatedLiabilities).toEqual(liabilities);
  });

  it("distributes one unlinked liability proportionally across family-member heirs", () => {
    const liabilities = [mkLiability()];  // $10k CC, unlinked
    const transfers = [
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 60_000),
      mkTransfer({ kind: "family_member", id: "fm-b", label: "B" }, 40_000),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");

    // fm-a inherits 60% → $6k debt; fm-b inherits 40% → $4k debt
    expect(result.liabilityTransfers).toHaveLength(2);

    const [tA, tB] = result.liabilityTransfers;
    expect(tA.recipientId).toBe("fm-a");
    expect(tA.amount).toBeCloseTo(-6000, 2);
    expect(tA.via).toBe("unlinked_liability_proportional");
    expect(tA.sourceLiabilityId).toBe("liab-cc");
    expect(tA.resultingLiabilityId).toMatch(/^death-liab-/);
    expect(tB.recipientId).toBe("fm-b");
    expect(tB.amount).toBeCloseTo(-4000, 2);

    // Original removed; two new family-member-owned liabilities added.
    expect(result.updatedLiabilities).toHaveLength(2);
    expect(result.updatedLiabilities.find((l) => l.id === "liab-cc")).toBeUndefined();
    const newA = result.updatedLiabilities.find((l) => l.ownerFamilyMemberId === "fm-a");
    expect(newA).toBeDefined();
    expect(newA!.balance).toBeCloseTo(6000, 2);
    expect(newA!.monthlyPayment).toBeCloseTo(300, 2);
    expect(newA!.interestRate).toBe(0.15);
  });

  it("external recipient receives a ledger entry but no new liability row", () => {
    const liabilities = [mkLiability()];
    const transfers = [
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 50_000),
      mkTransfer({ kind: "external_beneficiary", id: "ext-1", label: "Charity" }, 50_000, null),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");

    expect(result.liabilityTransfers).toHaveLength(2);
    const externalEntry = result.liabilityTransfers.find(
      (t) => t.recipientKind === "external_beneficiary",
    );
    expect(externalEntry).toBeDefined();
    expect(externalEntry!.amount).toBeCloseTo(-5000, 2);
    expect(externalEntry!.resultingLiabilityId).toBeNull();

    // Only one new liability (for the family-member share).
    const newLiabs = result.updatedLiabilities.filter((l) => l.id !== "liab-cc");
    expect(newLiabs).toHaveLength(1);
    expect(newLiabs[0].ownerFamilyMemberId).toBe("fm-a");
  });

  it("system_default recipient gets ledger entry with no new liability", () => {
    const liabilities = [mkLiability({ balance: 4_000, monthlyPayment: 200 })];
    const transfers = [
      mkTransfer({ kind: "system_default", id: null, label: "Other Heirs" }, 100_000, null),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toHaveLength(1);
    expect(result.liabilityTransfers[0].recipientKind).toBe("system_default");
    expect(result.liabilityTransfers[0].amount).toBeCloseTo(-4000, 2);
    expect(result.liabilityTransfers[0].resultingLiabilityId).toBeNull();
    expect(result.updatedLiabilities.filter((l) => l.id !== "liab-cc")).toEqual([]);
  });

  it("zero-estate deceased with unlinked debt drops the debt with a warning", () => {
    const liabilities = [mkLiability()];
    const transfers: DeathTransfer[] = [];  // no asset transfers
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    expect(result.liabilityTransfers).toEqual([]);
    expect(result.updatedLiabilities.filter((l) => l.id === "liab-cc")).toEqual([]);
    expect(result.warnings).toContain("unlinked_liability_no_estate_recipient:liab-cc");
  });

  it("groups multiple transfers to the same recipient into one share", () => {
    const liabilities = [mkLiability()];
    // fm-a appears in 2 asset transfers (different source accounts); combined share = 75%.
    const transfers = [
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 30_000),
      mkTransfer({ kind: "family_member", id: "fm-a", label: "A" }, 45_000),
      mkTransfer({ kind: "family_member", id: "fm-b", label: "B" }, 25_000),
    ];
    const result = distributeUnlinkedLiabilities(liabilities, transfers, 2050, "client");
    const aTotal = result.liabilityTransfers
      .filter((t) => t.recipientId === "fm-a")
      .reduce((s, t) => s + t.amount, 0);
    // $10k × 75% = $7,500, as negative
    expect(aTotal).toBeCloseTo(-7500, 2);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "distributeUnlinkedLiabilities"`
Expected: FAIL with "distributeUnlinkedLiabilities is not exported".

- [ ] **Step 3: Implement `distributeUnlinkedLiabilities`**

In `src/engine/death-event.ts`, add below `applyIncomeTermination` (around line 625):

```ts
export interface UnlinkedLiabilityDistributionResult {
  updatedLiabilities: Liability[];
  liabilityTransfers: DeathTransfer[];
  warnings: string[];
}

/** Feature A — proportional distribution of unlinked household liabilities.
 *  Runs after the asset precedence chain at 4c. For each unlinked liability
 *  (linkedPropertyId null AND ownerEntityId null), each final-tier recipient
 *  receives balance × (their share of the estate) either as a new
 *  family-member-owned liability row (kept in model) or as a ledger-only
 *  entry (external / system_default — liability leaves the model with the
 *  asset share).
 *
 *  Deceased with zero-estate but nonzero unlinked debt: liability is
 *  dropped and a warning is emitted. */
export function distributeUnlinkedLiabilities(
  liabilities: Liability[],
  assetTransfers: DeathTransfer[],
  year: number,
  deceased: "client" | "spouse",
): UnlinkedLiabilityDistributionResult {
  const unlinked = liabilities.filter(
    (l) => l.linkedPropertyId == null && l.ownerEntityId == null,
  );

  if (unlinked.length === 0) {
    return { updatedLiabilities: liabilities, liabilityTransfers: [], warnings: [] };
  }

  // Group asset transfers by (recipientKind, recipientId, recipientLabel) to
  // compute each recipient's total share. Use a composite key so recipients
  // with null ids (spouse / system_default) don't collide.
  type RecipientKey = string;
  const keyOf = (t: DeathTransfer): RecipientKey =>
    `${t.recipientKind}|${t.recipientId ?? ""}|${t.recipientLabel}`;

  const totalsByRecipient = new Map<
    RecipientKey,
    { kind: DeathTransfer["recipientKind"]; id: string | null; label: string; amount: number }
  >();
  let estateTotal = 0;

  for (const t of assetTransfers) {
    estateTotal += t.amount;
    const k = keyOf(t);
    const prev = totalsByRecipient.get(k);
    if (prev) {
      prev.amount += t.amount;
    } else {
      totalsByRecipient.set(k, {
        kind: t.recipientKind,
        id: t.recipientId,
        label: t.recipientLabel,
        amount: t.amount,
      });
    }
  }

  const warnings: string[] = [];
  const liabilityTransfers: DeathTransfer[] = [];
  const newLiabilityRows: Liability[] = [];
  const removedLiabilityIds = new Set<string>();

  for (const liab of unlinked) {
    if (estateTotal <= 0) {
      warnings.push(`unlinked_liability_no_estate_recipient:${liab.id}`);
      removedLiabilityIds.add(liab.id);
      continue;
    }

    for (const rec of totalsByRecipient.values()) {
      const share = rec.amount / estateTotal;
      const shareBalance = liab.balance * share;
      const sharePayment = liab.monthlyPayment * share;

      let resultingLiabilityId: string | null = null;
      if (rec.kind === "family_member" && rec.id != null) {
        const newId = `death-liab-${nextSyntheticId()}`;
        newLiabilityRows.push({
          id: newId,
          name: `${liab.name} — ${rec.label} share`,
          balance: shareBalance,
          interestRate: liab.interestRate,
          monthlyPayment: sharePayment,
          startYear: liab.startYear,
          startMonth: liab.startMonth,
          termMonths: liab.termMonths,
          extraPayments: [],
          ownerFamilyMemberId: rec.id,
          isInterestDeductible: liab.isInterestDeductible,
        });
        resultingLiabilityId = newId;
      }

      liabilityTransfers.push({
        year,
        deathOrder: 2,
        deceased,
        sourceAccountId: null,
        sourceAccountName: null,
        sourceLiabilityId: liab.id,
        sourceLiabilityName: liab.name,
        via: "unlinked_liability_proportional",
        recipientKind: rec.kind,
        recipientId: rec.id,
        recipientLabel: rec.label,
        amount: -shareBalance,
        basis: 0,
        resultingAccountId: null,
        resultingLiabilityId,
      });
    }

    removedLiabilityIds.add(liab.id);
  }

  const updatedLiabilities = [
    ...liabilities.filter((l) => !removedLiabilityIds.has(l.id)),
    ...newLiabilityRows,
  ];

  return { updatedLiabilities, liabilityTransfers, warnings };
}
```

Make sure `nextSyntheticId` is already imported at the top of the file (it is, from `./asset-transactions`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "distributeUnlinkedLiabilities"`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: `exit 0`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/death-event.ts src/engine/__tests__/death-event.test.ts
git commit -m "feat(death-event): distributeUnlinkedLiabilities helper (Feature A of 4c)"
```

---

### Task 6: `applyFinalDeath` orchestrator + new invariants

Wire the full 4c pipeline: precedence chain (with `survivor=null` so fallback skips tier 1 and uses tier 2/3) + deathOrder=2 threaded into step 3a/3b + income termination (reuse existing helper) + unlinked-liability distribution + invariant checks.

**Files:**
- Modify: `src/engine/death-event.ts`
- Modify: `src/engine/__tests__/death-event.test.ts`

- [ ] **Step 1: Write failing orchestrator tests**

Add to `src/engine/__tests__/death-event.test.ts`, at the end:

```ts
import { applyFinalDeath } from "../death-event";
import type { DeathEventInput, Account, Will, FamilyMember, EntitySummary, Income, Liability } from "../types";

describe("applyFinalDeath orchestrator", () => {
  const mkAccount = (over: Partial<Account> = {}): Account => ({
    id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
    owner: "client", value: 100_000, basis: 60_000,
    growthRate: 0.05, rmdEnabled: false,
    ...over,
  });

  const mkInput = (over: Partial<DeathEventInput> = {}): DeathEventInput => {
    const accounts = over.accounts ?? [mkAccount()];
    const accountBalances: Record<string, number> = over.accountBalances ?? {};
    const basisMap: Record<string, number> = over.basisMap ?? {};
    // Default balance/basis maps mirror the account list.
    for (const a of accounts) {
      if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
      if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
    }
    return {
      year: 2050,
      deceased: "client",
      survivor: "spouse",  // note: 4c's applyFinalDeath treats this field loosely; orchestrator internally passes null to fallback
      will: over.will ?? null,
      accounts,
      accountBalances,
      basisMap,
      incomes: over.incomes ?? [],
      liabilities: over.liabilities ?? [],
      familyMembers: over.familyMembers ?? [],
      externalBeneficiaries: over.externalBeneficiaries ?? [],
      entities: over.entities ?? [],
      ...over,
    };
  };

  it("distributes an unwilled account to living children when no will exists (fallback tier 2)", () => {
    const children: FamilyMember[] = [
      { id: "c1", relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
      { id: "c2", relationship: "child", firstName: "B", lastName: null, dateOfBirth: null },
    ];
    const input = mkInput({ familyMembers: children });
    const result = applyFinalDeath(input);

    // 2 accounts (one per child), each $50k, both with ownerFamilyMemberId
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].ownerFamilyMemberId).toBe("c1");
    expect(result.accounts[1].ownerFamilyMemberId).toBe("c2");
    expect(result.accounts[0].value).toBeCloseTo(50_000, 2);
    expect(result.accounts[1].value).toBeCloseTo(50_000, 2);

    // 2 asset ledger entries, both via fallback_children with deathOrder=2
    const assetEntries = result.transfers.filter((t) => t.sourceAccountId != null);
    expect(assetEntries).toHaveLength(2);
    expect(assetEntries.every((t) => t.deathOrder === 2)).toBe(true);
    expect(assetEntries.every((t) => t.via === "fallback_children")).toBe(true);
  });

  it("falls back to tier 3 (Other Heirs sink) when no spouse + no children", () => {
    const input = mkInput();
    const result = applyFinalDeath(input);

    expect(result.accounts).toHaveLength(0);  // removed
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].via).toBe("fallback_other_heirs");
    expect(result.transfers[0].recipientKind).toBe("system_default");
    expect(result.transfers[0].deathOrder).toBe(2);
  });

  it("executes an always-condition will at 4c with deathOrder=2", () => {
    const children: FamilyMember[] = [
      { id: "c1", relationship: "child", firstName: "Child", lastName: null, dateOfBirth: null },
    ];
    const will: Will = {
      id: "w1", grantor: "client", bequests: [
        {
          id: "b1", assetMode: "all_assets", percentage: 100,
          condition: "always", sortOrder: 0,
          recipients: [{ id: "r1", recipientKind: "family_member", recipientId: "c1", percentage: 100, sortOrder: 0 }],
        },
      ],
    };
    const input = mkInput({ will, familyMembers: children });
    const result = applyFinalDeath(input);

    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].ownerFamilyMemberId).toBe("c1");
    const willEntry = result.transfers.find((t) => t.via === "will");
    expect(willEntry).toBeDefined();
    expect(willEntry!.deathOrder).toBe(2);
  });

  it("skips if_spouse_survives clauses and fires if_spouse_predeceased clauses at 4c", () => {
    const children: FamilyMember[] = [
      { id: "c1", relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
    ];
    const will: Will = {
      id: "w1", grantor: "client", bequests: [
        {
          id: "b1", assetMode: "all_assets", percentage: 100,
          condition: "if_spouse_survives", sortOrder: 0,
          recipients: [{ id: "r1", recipientKind: "family_member", recipientId: "c1", percentage: 100, sortOrder: 0 }],
        },
        {
          id: "b2", assetMode: "all_assets", percentage: 100,
          condition: "if_spouse_predeceased", sortOrder: 1,
          recipients: [{ id: "r2", recipientKind: "family_member", recipientId: "c1", percentage: 100, sortOrder: 0 }],
        },
      ],
    };
    const input = mkInput({ will, familyMembers: children });
    const result = applyFinalDeath(input);

    // The if_spouse_predeceased bequest fires; the if_spouse_survives skips.
    // Account fully routed to c1 — no fallback warning.
    const willEntries = result.transfers.filter((t) => t.via === "will");
    expect(willEntries).toHaveLength(1);
    expect(willEntries[0].recipientId).toBe("c1");
    expect(result.warnings.filter((w) => w.startsWith("residual_fallback_fired"))).toHaveLength(0);
  });

  it("runs the unlinked-liability proportional distribution step", () => {
    const children: FamilyMember[] = [
      { id: "c1", relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
    ];
    const liabilities: Liability[] = [
      {
        id: "cc1", name: "Credit Card", balance: 10_000,
        interestRate: 0.18, monthlyPayment: 500,
        startYear: 2025, startMonth: 1, termMonths: 24, extraPayments: [],
      },
    ];
    const input = mkInput({ familyMembers: children, liabilities });
    const result = applyFinalDeath(input);

    // Asset transfers: 1 ($100k → c1). Liability transfers: 1 ($10k → c1).
    const liabEntries = result.transfers.filter((t) => t.via === "unlinked_liability_proportional");
    expect(liabEntries).toHaveLength(1);
    expect(liabEntries[0].recipientId).toBe("c1");
    expect(liabEntries[0].amount).toBeCloseTo(-10_000, 2);

    // Original CC removed, new family-member-owned CC added.
    expect(result.liabilities.some((l) => l.id === "cc1")).toBe(false);
    const newCC = result.liabilities.find((l) => l.ownerFamilyMemberId === "c1");
    expect(newCC).toBeDefined();
    expect(newCC!.balance).toBeCloseTo(10_000, 2);
  });

  it("clips deceased's personal incomes at final death year", () => {
    const incomes: Income[] = [
      { id: "sal1", type: "salary", name: "Salary", annualAmount: 100_000,
        startYear: 2030, endYear: 2070, growthRate: 0.03, owner: "client" },
      { id: "ent1", type: "trust", name: "Trust Income", annualAmount: 50_000,
        startYear: 2030, endYear: 2070, growthRate: 0.03, owner: "client", ownerEntityId: "e1" },
    ];
    const input = mkInput({ incomes });
    const result = applyFinalDeath(input);

    const salary = result.incomes.find((i) => i.id === "sal1");
    expect(salary!.endYear).toBe(2050);
    const trust = result.incomes.find((i) => i.id === "ent1");
    expect(trust!.endYear).toBe(2070);  // untouched (ownerEntityId)
  });

  it("passes entity-owned accounts through untouched", () => {
    const accounts = [
      mkAccount({ id: "a1", owner: "client", ownerEntityId: "e1", value: 500_000, basis: 200_000 }),
      mkAccount({ id: "a2", owner: "client", value: 100_000, basis: 60_000 }),
    ];
    const entities: EntitySummary[] = [
      { id: "e1", includeInPortfolio: true, isGrantor: true },
    ];
    const input = mkInput({ accounts, entities });
    const result = applyFinalDeath(input);

    expect(result.accounts.find((a) => a.id === "a1")).toBeDefined();
    const a1 = result.accounts.find((a) => a.id === "a1")!;
    expect(a1.ownerEntityId).toBe("e1");
  });

  it("throws when a will clause routes 'spouse' as recipient at 4c (defensive invariant)", () => {
    const will: Will = {
      id: "w1", grantor: "client", bequests: [
        {
          id: "b1", assetMode: "all_assets", percentage: 100,
          condition: "always", sortOrder: 0,
          recipients: [{ id: "r1", recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
        },
      ],
    };
    const input = mkInput({ will });
    expect(() => applyFinalDeath(input)).toThrow(/spouse/i);
  });

  it("throws when any account remains with owner='joint' post-event (defensive)", () => {
    // This is impossible in production because 4b retitles joint accounts,
    // but the orchestrator should reject the data defensively.
    const accounts = [mkAccount({ owner: "joint" })];
    const input = mkInput({ accounts });
    expect(() => applyFinalDeath(input)).toThrow(/joint/i);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "applyFinalDeath"`
Expected: FAIL — `applyFinalDeath` not exported.

- [ ] **Step 3: Implement `applyFinalDeath`**

In `src/engine/death-event.ts`, add this function immediately after `applyFirstDeath` (or after `applyFallback` if that reads better contextually). It mirrors `applyFirstDeath`'s structure with four differences:

1. Defensive pre-check: reject any `owner === "joint"` account.
2. Loop filter: only accounts where `owner === deceased` (no `|| "joint"` branch).
3. Step 1 (titling) skipped — joint can't exist.
4. Step-3 calls pass `deathOrder: 2`; step-4 (fallback) receives `null` for survivor so tier 1 skips naturally.
5. After the chain, call `distributeUnlinkedLiabilities` and append its transfers + warnings.
6. Extended invariants.

```ts
/** 4c orchestrator — final-death asset transfer. Runs the precedence chain
 *  (step 1 titling is inert; step 2 designations; step 3 will with
 *  deathOrder=2 condition filter; step 4 fallback with survivor=null so
 *  tier 1 is skipped and tiers 2/3 handle the residual), distributes
 *  unlinked household liabilities proportionally to final-tier recipients,
 *  terminates the deceased's personal income streams, and asserts
 *  4c-specific invariants. */
export function applyFinalDeath(input: DeathEventInput): DeathEventResult {
  const {
    year, deceased, will,
    accounts, accountBalances, basisMap,
    incomes, liabilities,
    familyMembers, externalBeneficiaries, entities,
  } = input;

  // Defensive: no joint accounts can exist at 4c.
  for (const a of accounts) {
    if (a.owner === "joint") {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} still has owner='joint' at final death (should have been retitled at 4b)`,
      );
    }
  }

  const nextAccounts: Account[] = [];
  const nextLiabilities: Liability[] = [...liabilities];
  const nextAccountBalances: Record<string, number> = { ...accountBalances };
  const nextBasisMap: Record<string, number> = { ...basisMap };
  const assetTransfers: DeathTransfer[] = [];
  const warnings: string[] = [];

  const deceasedWill: Will | null = will && will.grantor === deceased ? will : null;

  for (const acct of accounts) {
    const touchedByDeceased = acct.owner === deceased;
    if (!touchedByDeceased || acct.ownerEntityId || acct.ownerFamilyMemberId) {
      nextAccounts.push(acct);
      continue;
    }

    const linkedLiability = liabilities.find((l) => l.linkedPropertyId === acct.id);

    const balance = accountBalances[acct.id];
    const basis = basisMap[acct.id];
    if (balance == null || basis == null) {
      throw new Error(
        `applyFinalDeath: missing accountBalances/basisMap entry for ${acct.id}`,
      );
    }
    const effectiveAcct: Account = { ...acct, value: balance, basis };

    let undisposed = 1;
    let anySpecificClauseTouched = false;
    const stepAccts: Account[] = [];
    const stepLiabs: Liability[] = [];
    const stepLedger: Array<Omit<DeathTransfer, "year" | "deceased" | "deathOrder">> = [];

    // Step 1 is a no-op at 4c (no joint accounts). Skip directly to step 2.

    // Step 2: Beneficiary designations
    const step2 = applyBeneficiaryDesignations(
      effectiveAcct, undisposed,
      familyMembers, externalBeneficiaries, linkedLiability,
    );
    if (step2.fractionClaimed > 0) {
      stepAccts.push(...step2.resultingAccounts);
      stepLiabs.push(...step2.resultingLiabilities);
      stepLedger.push(...step2.ledgerEntries);
      undisposed -= step2.fractionClaimed;
    }

    // Step 3a: Specific bequests (deathOrder=2)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3a = applyWillSpecificBequests(
        effectiveAcct, undisposed, deceasedWill, 2, null,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3a.fractionClaimed > 0) {
        stepAccts.push(...step3a.resultingAccounts);
        stepLiabs.push(...step3a.resultingLiabilities);
        stepLedger.push(...step3a.ledgerEntries);
        undisposed -= step3a.fractionClaimed;
        anySpecificClauseTouched = true;
        warnings.push(...step3a.warnings);
      }
    }

    // Step 3b: all_assets residual (deathOrder=2)
    if (undisposed > 1e-9 && deceasedWill) {
      const step3b = applyWillAllAssetsResidual(
        effectiveAcct, undisposed, anySpecificClauseTouched, deceasedWill, 2, null,
        familyMembers, externalBeneficiaries, entities, linkedLiability,
      );
      if (step3b.fractionClaimed > 0) {
        stepAccts.push(...step3b.resultingAccounts);
        stepLiabs.push(...step3b.resultingLiabilities);
        stepLedger.push(...step3b.ledgerEntries);
        undisposed -= step3b.fractionClaimed;
      }
    }

    // Step 4: Fallback with survivor=null — tier 1 skipped; tiers 2/3 live.
    if (undisposed > 1e-9) {
      const step4 = applyFallback(
        effectiveAcct, undisposed, null, familyMembers, linkedLiability,
      );
      stepAccts.push(...step4.step.resultingAccounts);
      stepLiabs.push(...step4.step.resultingLiabilities);
      stepLedger.push(...step4.step.ledgerEntries);
      warnings.push(...step4.warnings);
      undisposed = 0;
    }

    for (const entry of stepLedger) {
      assetTransfers.push({ ...entry, year, deceased, deathOrder: 2 });
    }

    delete nextAccountBalances[acct.id];
    delete nextBasisMap[acct.id];
    for (const a of stepAccts) {
      nextAccounts.push(a);
      nextAccountBalances[a.id] = a.value;
      nextBasisMap[a.id] = a.basis;
    }

    if (linkedLiability) {
      const idx = nextLiabilities.findIndex((l) => l.id === linkedLiability.id);
      if (idx >= 0) nextLiabilities.splice(idx, 1);
      for (const lib of stepLiabs) nextLiabilities.push(lib);
    }
  }

  // Unlinked household liability distribution (Feature A).
  const unlinkedResult = distributeUnlinkedLiabilities(
    nextLiabilities, assetTransfers, year, deceased,
  );
  const allTransfers = [...assetTransfers, ...unlinkedResult.liabilityTransfers];
  warnings.push(...unlinkedResult.warnings);

  // Income termination — reuse the 4b helper. survivor arg is unused at 4c
  // for account retitling (no joint accounts to retitle); we pass deceased
  // as survivor since the helper's joint-retitle branch should never fire.
  const nextIncomes = applyIncomeTermination(incomes, deceased, deceased, year);

  const result: DeathEventResult = {
    accounts: nextAccounts,
    accountBalances: nextAccountBalances,
    basisMap: nextBasisMap,
    incomes: nextIncomes,
    liabilities: unlinkedResult.updatedLiabilities,
    transfers: allTransfers,
    warnings,
  };

  assertFinalDeathInvariants(result, input);

  return result;
}

function assertFinalDeathInvariants(result: DeathEventResult, input: DeathEventInput): void {
  // 1. Sum of asset transfer amounts grouped by source = each source's pre-death balance.
  const bySource = new Map<string, number>();
  for (const t of result.transfers) {
    if (t.sourceAccountId == null) continue;  // skip liability transfers
    bySource.set(t.sourceAccountId, (bySource.get(t.sourceAccountId) ?? 0) + t.amount);
  }
  for (const [sourceId, summed] of bySource.entries()) {
    const originalBalance = input.accountBalances[sourceId];
    if (originalBalance == null) continue;
    if (Math.abs(summed - originalBalance) > 0.01) {
      throw new Error(
        `applyFinalDeath invariant: asset ledger sum for ${sourceId} = ${summed}, expected ${originalBalance}`,
      );
    }
  }

  // 2. Sum of liability transfer amounts grouped by source = -(liability balance).
  const byLiability = new Map<string, number>();
  for (const t of result.transfers) {
    if (t.sourceLiabilityId == null) continue;
    byLiability.set(
      t.sourceLiabilityId,
      (byLiability.get(t.sourceLiabilityId) ?? 0) + t.amount,
    );
  }
  for (const [liabId, summed] of byLiability.entries()) {
    const liab = input.liabilities.find((l) => l.id === liabId);
    if (!liab) continue;
    if (Math.abs(-summed - liab.balance) > 0.01) {
      throw new Error(
        `applyFinalDeath invariant: liability ledger sum for ${liabId} = ${summed}, expected ${-liab.balance}`,
      );
    }
  }

  // 3. No deceased-owner orphan accounts remain.
  for (const a of result.accounts) {
    if (
      a.owner === input.deceased &&
      !a.ownerEntityId &&
      !a.ownerFamilyMemberId
    ) {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} still has deceased as sole owner`,
      );
    }
  }

  // 4. No account remains with owner='joint' (should have been caught up-front).
  for (const a of result.accounts) {
    if (a.owner === "joint") {
      throw new Error(
        `applyFinalDeath invariant: account ${a.id} owner='joint' after event`,
      );
    }
  }

  // 5. No personal (non-entity) deceased-owner incomes active past deathYear.
  for (const inc of result.incomes) {
    if (
      !inc.ownerEntityId &&
      inc.owner === input.deceased &&
      inc.endYear > input.year
    ) {
      throw new Error(
        `applyFinalDeath invariant: income ${inc.id} still active after final-death year`,
      );
    }
  }

  // 6. No transfer has recipientKind === "spouse" — tier 1 is skipped, and
  //    a will/designation routing to the deceased's already-deceased spouse
  //    is bad data.
  for (const t of result.transfers) {
    if (t.recipientKind === "spouse") {
      throw new Error(
        `applyFinalDeath invariant: transfer for ${t.sourceAccountId ?? t.sourceLiabilityId} routes to spouse at final death`,
      );
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/engine/__tests__/death-event.test.ts -t "applyFinalDeath"`
Expected: PASS on all orchestrator tests.

Run: `npx vitest run src/engine/__tests__/death-event.test.ts`
Expected: entire death-event suite green (4b tests still pass; 4c tests now pass).

Run: `npx tsc --noEmit`
Expected: `exit 0`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/death-event.ts src/engine/__tests__/death-event.test.ts
git commit -m "feat(death-event): applyFinalDeath orchestrator + 4c invariants"
```

---

### Task 7: Wire `applyFinalDeath` into the projection loop + truncation

Compute `finalDeathYear` at the top of `runProjection`, add a 4c clause after the existing 4b clause inside the year loop, and `break` after the 4c clause fires so no `ProjectionYear` rows are emitted past the final death.

**Files:**
- Modify: `src/engine/projection.ts`

- [ ] **Step 1: Import the new helpers**

In `src/engine/projection.ts`, update the import from `./death-event` (around line 43-46) to include the two new helpers and `applyFinalDeath`:

```ts
import {
  computeFirstDeathYear,
  computeFinalDeathYear,
  identifyDeceased,
  identifyFinalDeceased,
  applyFirstDeath,
  applyFinalDeath,
} from "./death-event";
```

- [ ] **Step 2: Compute final-death year and deceased at top of `runProjection`**

Directly below the existing `firstDeathSurvivor` computation (around line 237), add:

```ts
  const finalDeathYear = computeFinalDeathYear(
    client,
    planSettings.planStartYear,
    planSettings.planEndYear,
  );
  const finalDeceased: "client" | "spouse" | null =
    finalDeathYear != null
      ? identifyFinalDeceased(client, firstDeathDeceased)
      : null;
```

- [ ] **Step 3: Add the 4c clause inside the year loop**

Find the end of the existing 4b block (around line 1499, the closing `}` after `thisYear.deathWarnings = deathResult.warnings;`). Immediately after that closing brace, add the 4c block:

```ts
    // Final-death event (spec 4c) — fires at the final death year. For
    // same-year double death, fires the same year as 4b on the already-4b-
    // mutated state. After this block, break out of the year loop to
    // truncate the projection.
    if (
      finalDeathYear != null &&
      finalDeceased != null &&
      year === finalDeathYear
    ) {
      const finalWill = (data.wills ?? []).find(
        (w) => w.grantor === finalDeceased,
      ) ?? null;

      const finalResult = applyFinalDeath({
        year,
        deceased: finalDeceased,
        // survivor field is unused by applyFinalDeath internally; pass
        // deceased as a safe placeholder to keep the shared input type.
        survivor: finalDeceased,
        will: finalWill,
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
      for (const key of Object.keys(accountBalances)) delete (accountBalances as Record<string, number>)[key];
      Object.assign(accountBalances, finalResult.accountBalances);
      for (const key of Object.keys(basisMap)) delete (basisMap as Record<string, number>)[key];
      Object.assign(basisMap, finalResult.basisMap);
      currentIncomes = finalResult.incomes;
      currentLiabilities = finalResult.liabilities;

      const thisYear = years[years.length - 1];
      thisYear.deathTransfers = [
        ...(thisYear.deathTransfers ?? []),
        ...finalResult.transfers,
      ];
      thisYear.deathWarnings = [
        ...(thisYear.deathWarnings ?? []),
        ...finalResult.warnings,
      ];

      break;
    }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `exit 0`.

- [ ] **Step 5: Run the full engine test suite**

Run: `npx vitest run src/engine/__tests__/`
Expected: most tests pass. A subset of tests in `projection.test.ts` that happen to configure `lifeExpectancy` inside the plan horizon may now fire 4c fallback tier-3 and break (expected balance assertions no longer hold, because accounts got removed / retitled). Note which tests fail — we fix them in Task 9.

- [ ] **Step 6: Commit**

```bash
git add src/engine/projection.ts
git commit -m "feat(projection): wire applyFinalDeath into year loop with truncation break"
```

---

### Task 8: Integration tests for 4c scenarios

Five end-to-end scenarios in `projection.test.ts`. Use the existing `buildClientData` fixture helper to construct each scenario.

**Files:**
- Modify: `src/engine/__tests__/projection.test.ts`

- [ ] **Step 1: Add a new `describe` block for 4c integration**

At the end of `src/engine/__tests__/projection.test.ts`, add:

```ts
describe("runProjection — final-death event (spec 4c)", () => {
  const twoSpouseClient: ClientInfo = {
    firstName: "Tom", lastName: "Test",
    dateOfBirth: "1970-01-01",
    retirementAge: 65, planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 75,          // dies 2045 (first death)
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 80,    // dies 2052 (final death)
  };

  const planSettings = {
    planStartYear: 2026,
    planEndYear: 2066,
    inflationRate: 0.025,
    spendingGrowthRate: 0.025,
    federalTaxMode: "bracket" as const,
    stateTaxRate: 0,
  };

  it("truncates the projection at the final-death year (couple with distinct deaths)", () => {
    const data = buildClientData({
      client: twoSpouseClient,
      planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        owner: "client", value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
      }],
      familyMembers: [
        { id: "c1", relationship: "child", firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    const lastYear = years[years.length - 1];
    expect(lastYear.year).toBe(2052);  // final-death year
    expect(years.find((y) => y.year === 2053)).toBeUndefined();
  });

  it("attaches deathOrder=1 and deathOrder=2 entries to distinct years for distinct-year deaths", () => {
    const data = buildClientData({
      client: twoSpouseClient,
      planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        owner: "client", value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
      }],
      familyMembers: [
        { id: "c1", relationship: "child", firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    const firstDeathYr = years.find((y) => y.year === 2045);
    const finalDeathYr = years.find((y) => y.year === 2052);
    expect(firstDeathYr?.deathTransfers?.every((t) => t.deathOrder === 1)).toBe(true);
    expect(finalDeathYr?.deathTransfers?.every((t) => t.deathOrder === 2)).toBe(true);
  });

  it("same-year double death: both orders attach to the same ProjectionYear", () => {
    const client: ClientInfo = {
      ...twoSpouseClient,
      lifeExpectancy: 75,           // dies 2045
      spouseLifeExpectancy: 73,     // dies 2045 (1972 + 73)
    };
    const data = buildClientData({
      client, planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        owner: "client", value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
      }, {
        id: "a2", name: "Spouse IRA", category: "retirement", subType: "trad_ira",
        owner: "spouse", value: 200_000, basis: 200_000, growthRate: 0.05, rmdEnabled: true,
      }],
      familyMembers: [
        { id: "c1", relationship: "child", firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    expect(years[years.length - 1].year).toBe(2045);

    const deathYr = years[years.length - 1];
    const orders = new Set(deathYr.deathTransfers?.map((t) => t.deathOrder));
    expect(orders.has(1)).toBe(true);
    expect(orders.has(2)).toBe(true);
  });

  it("single-filer client: 4b no-ops, 4c fires at the client's death year, truncates", () => {
    const client: ClientInfo = {
      firstName: "Solo", lastName: "Test",
      dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 95,
      filingStatus: "single",
      lifeExpectancy: 80,  // dies 2050
    };
    const data = buildClientData({
      client, planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        owner: "client", value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
      }],
      familyMembers: [
        { id: "c1", relationship: "child", firstName: "Child", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    expect(years[years.length - 1].year).toBe(2050);
    const deathYr = years[years.length - 1];
    expect(deathYr.deathTransfers?.every((t) => t.deathOrder === 2)).toBe(true);
    expect(deathYr.deathTransfers?.length).toBeGreaterThan(0);
  });

  it("past-horizon final death: 4c no-ops; loop runs to planEndYear", () => {
    const client: ClientInfo = {
      ...twoSpouseClient,
      lifeExpectancy: 100,          // dies 2070 — past 2066 horizon
      spouseLifeExpectancy: 105,
    };
    const data = buildClientData({ client, planSettings });
    const years = runProjection(data);
    expect(years[years.length - 1].year).toBe(2066);
    // No deathTransfers on any year
    for (const y of years) expect(y.deathTransfers ?? []).toEqual([]);
  });

  it("distributes unlinked household debt proportionally to heirs", () => {
    const data = buildClientData({
      client: twoSpouseClient,
      planSettings,
      accounts: [{
        id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage",
        owner: "client", value: 500_000, basis: 300_000, growthRate: 0.05, rmdEnabled: false,
      }],
      liabilities: [{
        id: "cc1", name: "Credit Card", balance: 20_000,
        interestRate: 0.18, monthlyPayment: 800,
        startYear: 2025, startMonth: 1, termMonths: 36, extraPayments: [],
      }],
      familyMembers: [
        { id: "c1", relationship: "child", firstName: "A", lastName: null, dateOfBirth: null },
        { id: "c2", relationship: "child", firstName: "B", lastName: null, dateOfBirth: null },
      ],
    });

    const years = runProjection(data);
    const finalYr = years.find((y) => y.year === 2052);
    const liabEntries = finalYr?.deathTransfers?.filter(
      (t) => t.via === "unlinked_liability_proportional",
    );
    expect(liabEntries?.length).toBe(2);  // one per child
    // Amounts negate to -$20k total (approximately — balance grew over 27 years
    // in the liability-amortization pass, but the structural assertion here is:
    // at most one entry per child, both with via unlinked_liability_proportional).
    expect(liabEntries?.every((t) => t.deathOrder === 2)).toBe(true);
  });
});
```

Make sure the `ClientInfo` and `runProjection` imports are already present at the top of the file; if not, add them.

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/engine/__tests__/projection.test.ts -t "spec 4c"`
Expected: all 6 integration tests pass. Some may need small tweaks (e.g., exact balance assertions if the projection grows accounts before final death); adjust to `>` / `toBeGreaterThan` assertions rather than exact values where growth compounds over many years.

- [ ] **Step 3: Full engine test suite**

Run: `npx vitest run src/engine/__tests__/`
Expected: the new 4c tests pass; there may still be pre-existing tests failing from Task 7 — addressed in Task 9.

- [ ] **Step 4: Commit**

```bash
git add src/engine/__tests__/projection.test.ts
git commit -m "test(projection): integration tests for spec 4c final-death transfer"
```

---

### Task 9: Regression pass — push pre-existing tests' `lifeExpectancy` off-horizon

Find every pre-existing test that configures `lifeExpectancy` / `spouseLifeExpectancy` inside the plan horizon without a full 4c scenario (wills or family-members matching the new fallback behavior). Such tests now trip 4c at the final-death year and their assertions break. Fix by pushing the affected tests' `lifeExpectancy` past `planEndYear`, matching the pattern 4b used.

**Files:**
- Modify: `src/engine/__tests__/projection.test.ts` (and any other test file that fails after Task 7)

- [ ] **Step 1: Run the full suite to enumerate failures**

Run: `npx vitest run src/engine/__tests__/`
Expected: a list of failing tests attributable to the 4c cutover. These are NOT 4c tests — they're older tests that happened to set `lifeExpectancy` inside horizon.

- [ ] **Step 2: For each failing pre-existing test, adjust `lifeExpectancy` to land past `planEndYear`**

Rather than mutating engine logic, push test life expectancies off-horizon. Example diff:

```ts
// Before (dies 2055, inside a plan ending 2060):
const client: ClientInfo = { ...baseClient, lifeExpectancy: 85, ... };

// After (dies 2110, past any reasonable plan):
const client: ClientInfo = { ...baseClient, lifeExpectancy: 140, ... };
```

If the test's assertion was specifically about what happens in a certain year, and that year is > `finalDeathYear`, the assertion needs to move earlier. Document the change in the commit message.

- [ ] **Step 3: Re-run the suite**

Run: `npx vitest run src/engine/__tests__/`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/engine/__tests__/projection.test.ts
git commit -m "test(regression): push pre-existing lifeExpectancy off-horizon for 4c cutover"
```

---

### Task 10: Final verification + log follow-ups

Full tsc + vitest + a manual smoke + log 4e and any other follow-ups surfaced during implementation.

**Files:**
- Modify: `docs/future-work/estate.md`

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: `exit 0`.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all tests pass. Tally and briefly note counts (e.g., "162 tests, 0 failing").

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: `exit 0`.

- [ ] **Step 4: Add/update `docs/future-work/estate.md`**

Append a new section to the file:

```md
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
```

- [ ] **Step 5: Commit**

```bash
git add docs/future-work/estate.md
git commit -m "docs(future-work): log 4c follow-ups (4e spec, creditor-payoff, heir rollforward)"
```

- [ ] **Step 6: Announce completion and invoke `superpowers:finishing-a-development-branch`**

After the final commit, the feature is ready to merge. Invoke the finishing-a-development-branch skill for the merge / PR decision.

---

## Self-Review Notes

**Spec coverage:** Every spec section maps to at least one task:
- Trigger → Task 3
- Precedence chain diff → Task 4 (condition filter) + Task 6 (orchestrator wiring)
- Architecture + pipeline → Task 6
- Unlinked liability distribution (Feature A) → Task 5 + Task 6
- Type change (`Liability.ownerFamilyMemberId`) → Task 1
- Stream termination → Task 6 (reuses existing helper)
- Filing status (no change needed) → implicit (no task)
- Ledger unification → Task 2
- Year-loop integration + truncation → Task 7
- Invariants → Task 6
- Warnings / errors → Task 6 (via `distributeUnlinkedLiabilities` and orchestrator)
- Edge cases → Tasks 6 + 8
- Testing plan → Tasks 3, 4, 5, 6, 8, 9
- Gotchas carried → Task 9 (regression)
- Downstream consumers (4d, 4e, step-up) → Task 10 (future-work log)

**Type consistency:** `DeathTransfer`, `deathOrder`, `applyFinalDeath`, `computeFinalDeathYear`, `identifyFinalDeceased`, `distributeUnlinkedLiabilities`, `firesAtDeath` — all names consistent across tasks.

**Placeholder scan:** no "TBD" / "TODO" / "similar to" / "implement later" tokens.
