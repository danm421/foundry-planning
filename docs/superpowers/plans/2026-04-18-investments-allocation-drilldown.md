# Investments Asset Allocation Drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the advisor click any asset-class row in the Allocation Details table (including the Unallocated bucket) to drill into an account-level breakdown: account name, $ contributed to that class, % of class, % of that account. Donut and drift chart remain untouched.

**Architecture:** Extend `computeHouseholdAllocation` to also produce per-asset-class account contributions as a side product of the existing per-account rollup. Thread the new fields through the server component. Client component keeps a `drilledClassId` state that swaps the left-column table between `AllocationTable` (default) and a new `AllocationDrillTable` (drilled). Session-only state; no schema or API changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, drizzle-orm, vitest. Matches the Phase 1 stack.

**Design spec:** [docs/superpowers/specs/2026-04-18-investments-allocation-drilldown-design.md](../specs/2026-04-18-investments-allocation-drilldown-design.md)

**Branch:** `investments-allocation-drilldown` (already created; contains only the design spec commit).

---

## Conventions used throughout

- **Typecheck:** `npx tsc --noEmit` — expected: no output, exit 0.
- **Unit tests:** `npx vitest run` — expected: all tests pass.
- **Build (once before push):** `npm run build`.
- Tests live in `src/lib/investments/__tests__/`, matching the Phase 1 pattern.
- Imports for React types should prefer `import type { ... }` where possible (existing Phase 1 style).

---

# Commit 1 — Math + tests (extend `computeHouseholdAllocation`)

## Task 1.1: Add `AccountContribution` and extend `HouseholdAllocation`

**Files:**
- Modify: `src/lib/investments/allocation.ts`
- Create: `src/lib/investments/__tests__/allocation-contributions.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/investments/__tests__/allocation-contributions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeHouseholdAllocation,
  type InvestableAccount,
  type AccountLite,
  type AccountAllocationResult,
} from "../allocation";

const ASSET_CLASSES = [
  { id: "ac-eq", name: "US Equity", sortOrder: 0 },
  { id: "ac-bond", name: "US Bonds", sortOrder: 1 },
];

function mkAccount(
  id: string,
  name: string,
  category: AccountLite["category"],
  value: number,
  ownerEntityId: string | null = null,
): InvestableAccount {
  return {
    id,
    name,
    category,
    growthSource: "custom",
    modelPortfolioId: null,
    value,
    ownerEntityId,
  };
}

describe("computeHouseholdAllocation contributions", () => {
  it("records per-account contributions keyed by asset class id", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("a2", "John 401(k)", "retirement", 300_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") {
        return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      }
      return {
        classified: [
          { assetClassId: "ac-eq", weight: 0.5 },
          { assetClassId: "ac-bond", weight: 0.5 },
        ],
      };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    // a1 -> 100k eq. a2 -> 150k eq + 150k bond. Sorted desc by valueInClass.
    expect(out.contributionsByAssetClass["ac-eq"]).toEqual([
      {
        accountId: "a2",
        accountName: "John 401(k)",
        accountValue: 300_000,
        valueInClass: 150_000,
        weightInClass: 0.5,
      },
      {
        accountId: "a1",
        accountName: "Joint Brokerage",
        accountValue: 100_000,
        valueInClass: 100_000,
        weightInClass: 1,
      },
    ]);
    expect(out.contributionsByAssetClass["ac-bond"]).toEqual([
      {
        accountId: "a2",
        accountName: "John 401(k)",
        accountValue: 300_000,
        valueInClass: 150_000,
        weightInClass: 0.5,
      },
    ]);
    expect(out.unallocatedContributions).toEqual([]);
  });

  it("sorts contributions descending by valueInClass", () => {
    const accounts = [
      mkAccount("a-small", "Small", "taxable", 10_000),
      mkAccount("a-big", "Big", "taxable", 500_000),
      mkAccount("a-mid", "Mid", "taxable", 100_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual([
      "a-big",
      "a-mid",
      "a-small",
    ]);
  });

  it("routes unresolvable accounts into unallocatedContributions with weightInClass=1", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("a2", "Opaque Account", "cash", 50_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") {
        return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      }
      return { unallocated: true };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.unallocatedContributions).toEqual([
      {
        accountId: "a2",
        accountName: "Opaque Account",
        accountValue: 50_000,
        valueInClass: 50_000,
        weightInClass: 1,
      },
    ]);
    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual(["a1"]);
  });

  it("excludes non-investable accounts from contributions entirely", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("biz", "LLC Equity", "business", 500_000),
      mkAccount("home", "Primary Home", "real_estate", 800_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual(["a1"]);
    expect(out.unallocatedContributions).toEqual([]);
  });

  it("excludes OOE accounts from contributions (counted only in excludedNonInvestableValue)", () => {
    const accounts = [
      mkAccount("a1", "Joint Brokerage", "taxable", 100_000),
      mkAccount("trust", "Trust Brokerage", "taxable", 250_000, "entity-1"),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.contributionsByAssetClass["ac-eq"]!.map((c) => c.accountId)).toEqual(["a1"]);
  });

  it("returns an empty contributions map when there are no investable accounts", () => {
    const out = computeHouseholdAllocation([], () => ({ unallocated: true }), ASSET_CLASSES);
    expect(out.contributionsByAssetClass).toEqual({});
    expect(out.unallocatedContributions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/lib/investments/__tests__/allocation-contributions.test.ts`
Expected: FAIL — compile errors because `accountName` doesn't exist on `InvestableAccount` yet, and `contributionsByAssetClass` / `unallocatedContributions` don't exist on `HouseholdAllocation` yet.

- [ ] **Step 3: Add `name` to `InvestableAccount` and `AccountContribution` + field additions in allocation.ts**

Open `src/lib/investments/allocation.ts`. Make three edits, carefully preserving existing code.

**Edit A** — extend `InvestableAccount` with a `name` field. Find:

```ts
export interface InvestableAccount extends AccountLite {
  value: number;
  ownerEntityId: string | null;
}
```

Change to:

```ts
export interface InvestableAccount extends AccountLite {
  name: string;
  value: number;
  ownerEntityId: string | null;
}
```

**Edit B** — add `AccountContribution` interface and extend `HouseholdAllocation`. Find:

```ts
export interface HouseholdAllocation {
  byAssetClass: AssetClassRollup[];
  unallocatedValue: number;
  totalClassifiedValue: number;
  totalInvestableValue: number;
  excludedNonInvestableValue: number;
}
```

Replace with:

```ts
export interface AccountContribution {
  accountId: string;
  accountName: string;
  accountValue: number;
  valueInClass: number;
  weightInClass: number;
}

export interface HouseholdAllocation {
  byAssetClass: AssetClassRollup[];
  unallocatedValue: number;
  totalClassifiedValue: number;
  totalInvestableValue: number;
  excludedNonInvestableValue: number;
  contributionsByAssetClass: Record<string, AccountContribution[]>;
  unallocatedContributions: AccountContribution[];
}
```

**Edit C** — populate the new fields inside `computeHouseholdAllocation`. The current implementation has one per-account loop. Keep the loop; add contribution tracking inside it, and assemble + sort contributions after.

Find the existing function body:

```ts
export function computeHouseholdAllocation(
  accounts: InvestableAccount[],
  resolver: (acct: AccountLite) => AccountAllocationResult,
  assetClasses: AssetClassLite[],
): HouseholdAllocation {
  let totalInvestableValue = 0;
  let unallocatedValue = 0;
  let excludedNonInvestableValue = 0;
  const byId = new Map<string, number>();

  for (const acct of accounts) {
    const isInvestable = INVESTABLE_CATEGORIES.has(acct.category) && acct.ownerEntityId === null;
    if (!isInvestable) {
      excludedNonInvestableValue += acct.value;
      continue;
    }
    totalInvestableValue += acct.value;

    const result = resolver(acct);
    if ("unallocated" in result) {
      unallocatedValue += acct.value;
      continue;
    }
    for (const row of result.classified) {
      const dollars = acct.value * row.weight;
      byId.set(row.assetClassId, (byId.get(row.assetClassId) ?? 0) + dollars);
    }
  }

  const totalClassifiedValue = totalInvestableValue - unallocatedValue;

  const byAssetClass: AssetClassRollup[] = assetClasses
    .map((ac) => {
      const value = byId.get(ac.id) ?? 0;
      return {
        id: ac.id,
        name: ac.name,
        sortOrder: ac.sortOrder,
        value,
        pctOfClassified: totalClassifiedValue > 0 ? value / totalClassifiedValue : 0,
      };
    })
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);

  return {
    byAssetClass,
    unallocatedValue,
    totalClassifiedValue,
    totalInvestableValue,
    excludedNonInvestableValue,
  };
}
```

Replace the entire function with:

```ts
export function computeHouseholdAllocation(
  accounts: InvestableAccount[],
  resolver: (acct: AccountLite) => AccountAllocationResult,
  assetClasses: AssetClassLite[],
): HouseholdAllocation {
  let totalInvestableValue = 0;
  let unallocatedValue = 0;
  let excludedNonInvestableValue = 0;
  const byId = new Map<string, number>();
  const contribById = new Map<string, AccountContribution[]>();
  const unallocatedContributions: AccountContribution[] = [];

  for (const acct of accounts) {
    const isInvestable = INVESTABLE_CATEGORIES.has(acct.category) && acct.ownerEntityId === null;
    if (!isInvestable) {
      excludedNonInvestableValue += acct.value;
      continue;
    }
    totalInvestableValue += acct.value;

    const result = resolver(acct);
    if ("unallocated" in result) {
      unallocatedValue += acct.value;
      unallocatedContributions.push({
        accountId: acct.id,
        accountName: acct.name,
        accountValue: acct.value,
        valueInClass: acct.value,
        weightInClass: 1,
      });
      continue;
    }
    for (const row of result.classified) {
      const dollars = acct.value * row.weight;
      byId.set(row.assetClassId, (byId.get(row.assetClassId) ?? 0) + dollars);

      const list = contribById.get(row.assetClassId) ?? [];
      list.push({
        accountId: acct.id,
        accountName: acct.name,
        accountValue: acct.value,
        valueInClass: dollars,
        weightInClass: row.weight,
      });
      contribById.set(row.assetClassId, list);
    }
  }

  const totalClassifiedValue = totalInvestableValue - unallocatedValue;

  const byAssetClass: AssetClassRollup[] = assetClasses
    .map((ac) => {
      const value = byId.get(ac.id) ?? 0;
      return {
        id: ac.id,
        name: ac.name,
        sortOrder: ac.sortOrder,
        value,
        pctOfClassified: totalClassifiedValue > 0 ? value / totalClassifiedValue : 0,
      };
    })
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);

  const contributionsByAssetClass: Record<string, AccountContribution[]> = {};
  for (const [classId, list] of contribById) {
    contributionsByAssetClass[classId] = list
      .slice()
      .sort((a, b) => b.valueInClass - a.valueInClass);
  }

  unallocatedContributions.sort((a, b) => b.valueInClass - a.valueInClass);

  return {
    byAssetClass,
    unallocatedValue,
    totalClassifiedValue,
    totalInvestableValue,
    excludedNonInvestableValue,
    contributionsByAssetClass,
    unallocatedContributions,
  };
}
```

- [ ] **Step 4: Run the new test suite — expect pass**

Run: `npx vitest run src/lib/investments/__tests__/allocation-contributions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run existing investment tests — expect all still pass**

The existing `allocation-household.test.ts` uses `mkAccount` that does NOT set `name`. Adding a required `name` field to `InvestableAccount` will break that test's type-checking. Fix the existing test file by adding a default `name`.

Find `src/lib/investments/__tests__/allocation-household.test.ts`. Locate the existing `mkAccount` helper:

```ts
function mkAccount(
  id: string,
  category: AccountLite["category"],
  value: number,
  ownerEntityId: string | null = null,
): AccountLite & { value: number; ownerEntityId: string | null } {
  return { id, category, growthSource: "custom", modelPortfolioId: null, value, ownerEntityId };
}
```

Replace with:

```ts
function mkAccount(
  id: string,
  category: AccountLite["category"],
  value: number,
  ownerEntityId: string | null = null,
): InvestableAccount {
  return { id, name: id, category, growthSource: "custom", modelPortfolioId: null, value, ownerEntityId };
}
```

At the top of `allocation-household.test.ts`, find the existing import and add `InvestableAccount`:

```ts
import {
  computeHouseholdAllocation,
  type AccountLite,
  type AccountAllocationResult,
} from "../allocation";
```

Change to:

```ts
import {
  computeHouseholdAllocation,
  type AccountLite,
  type AccountAllocationResult,
  type InvestableAccount,
} from "../allocation";
```

- [ ] **Step 6: Run full vitest suite + typecheck**

Run: `npx vitest run`
Expected: all tests pass (existing 433 + new 6 = 439).

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/investments/allocation.ts src/lib/investments/__tests__/
git commit -m "feat(investments): per-account contributions in household allocation rollup"
```

---

# Commit 2 — Server wiring + drill-table component

## Task 2.1: Thread `accountName` through the server component

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/page.tsx`

- [ ] **Step 1: Add `name` to the `InvestableAccount` construction**

Open `src/app/(app)/clients/[id]/investments/page.tsx`. Find the block that constructs `investableAccounts`:

```tsx
  const investableAccounts: InvestableAccount[] = acctRows.map((a) => ({
    id: a.id,
    category: a.category,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    value: Number(a.value),
    ownerEntityId: a.ownerEntityId ?? null,
  }));
```

Replace with:

```tsx
  const investableAccounts: InvestableAccount[] = acctRows.map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    value: Number(a.value),
    ownerEntityId: a.ownerEntityId ?? null,
  }));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

The `page.tsx` passes the full `household` object (which now contains `contributionsByAssetClass` and `unallocatedContributions`) through to `<InvestmentsClient />` already — no change to the props passed. `InvestmentsClient` doesn't destructure those sub-fields itself until Task 3.1.

- [ ] **Step 3: No commit yet** — Task 2.2 creates the drill-table component and commits both together.

---

## Task 2.2: Create `AllocationDrillTable` presentational component

**Files:**
- Create: `src/app/(app)/clients/[id]/investments/allocation-drill-table.tsx`

- [ ] **Step 1: Create the component**

Create `src/app/(app)/clients/[id]/investments/allocation-drill-table.tsx`:

```tsx
"use client";

import type { AccountContribution } from "@/lib/investments/allocation";

interface Props {
  assetClassName: string;
  assetClassColor: string;
  currentPct: number;
  targetPct: number | null;
  contributions: AccountContribution[];
  totalInClass: number;
  onBack: () => void;
  isUnallocated?: boolean;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function dollars(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function AllocationDrillTable({
  assetClassName,
  assetClassColor,
  currentPct,
  targetPct,
  contributions,
  totalInClass,
  onBack,
  isUnallocated = false,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-xs text-gray-400 hover:text-gray-200"
      >
        ← All asset classes
      </button>

      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: assetClassColor }} />
          {assetClassName}
        </div>
        {!isUnallocated && (
          <div className="mt-1 text-xs text-gray-500">
            Current {pct(currentPct)}
            {targetPct !== null && (
              <>
                {"  ·  "}
                Target {pct(targetPct)}
              </>
            )}
          </div>
        )}
      </div>

      {contributions.length === 0 ? (
        <div className="text-xs text-gray-500">No accounts contribute to this asset class.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="px-2 py-2 font-medium">Account</th>
                <th className="px-2 py-2 text-right font-medium">$ class</th>
                <th className="px-2 py-2 text-right font-medium">% class</th>
                <th className="px-2 py-2 text-right font-medium">% account</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => {
                const pctOfClass = totalInClass > 0 ? c.valueInClass / totalInClass : 0;
                return (
                  <tr key={c.accountId} className="border-b border-gray-900">
                    <td className="px-2 py-2 text-gray-200">{c.accountName}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-200">{dollars(c.valueInClass)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-200">{pct(pctOfClass)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-200">{pct(c.weightInClass)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-gray-700 font-semibold text-gray-200">
                <td className="px-2 py-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums">{dollars(totalInClass)}</td>
                <td className="px-2 py-2 text-right tabular-nums">100.0%</td>
                <td className="px-2 py-2 text-right text-gray-500">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. (No tests for this UI component — repo convention is manual smoke; it gets exercised in Task 3.1.)

- [ ] **Step 3: Run full vitest suite — expect all still pass**

Run: `npx vitest run`
Expected: 439 tests pass.

- [ ] **Step 4: Commit both 2.1 and 2.2 together**

```bash
git add src/app/\(app\)/clients/\[id\]/investments/page.tsx \
  src/app/\(app\)/clients/\[id\]/investments/allocation-drill-table.tsx
git commit -m "feat(investments): threaded account names + AllocationDrillTable component"
```

---

# Commit 3 — Wire drill interactions

## Task 3.1: Add `onRowClick` to `AllocationTable` + drill state in `InvestmentsClient`

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/allocation-table.tsx`
- Modify: `src/app/(app)/clients/[id]/investments/investments-client.tsx`

- [ ] **Step 1: Make `AllocationTable` rows clickable**

Open `src/app/(app)/clients/[id]/investments/allocation-table.tsx`. Make four edits.

**Edit A** — extend the `Props` interface. Find:

```tsx
interface Props {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number }[];
}
```

Replace with:

```tsx
interface Props {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number }[];
  onRowClick: (rowId: string) => void;
}
```

**Edit B** — destructure the new prop in the function signature. Find:

```tsx
export default function AllocationTable({ household, benchmarkWeights, assetClasses }: Props) {
```

Replace with:

```tsx
export default function AllocationTable({ household, benchmarkWeights, assetClasses, onRowClick }: Props) {
```

**Edit C** — make each asset-class `<tr>` clickable + keyboard-accessible. Find the mapped `<tr>` in the `rows.map((r) => { ... })` block:

```tsx
              <tr key={r.id} className="border-b border-gray-900">
```

Replace with:

```tsx
              <tr
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onRowClick(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(r.id);
                  }
                }}
                className="cursor-pointer border-b border-gray-900 hover:bg-gray-800/60"
              >
```

**Edit D** — make the Unallocated `<tr>` clickable. Find:

```tsx
          {household.unallocatedValue > 0 && (
            <tr className="italic text-gray-500">
```

Replace with:

```tsx
          {household.unallocatedValue > 0 && (
            <tr
              role="button"
              tabIndex={0}
              onClick={() => onRowClick("__unallocated__")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick("__unallocated__");
                }
              }}
              className="cursor-pointer italic text-gray-500 hover:bg-gray-800/60"
            >
```

- [ ] **Step 2: Add drill state in `InvestmentsClient` and swap the left-column view**

Open `src/app/(app)/clients/[id]/investments/investments-client.tsx`. Make several edits.

**Edit A** — add the palette import + the new drill-table import at the top (alongside existing imports). Find:

```tsx
import CommentDialog from "./comment-dialog";
import BenchmarkSelector from "./benchmark-selector";
import AllocationDonut from "./allocation-donut";
import AllocationTable from "./allocation-table";
import DriftChart from "./drift-chart";
import type { HouseholdAllocation, DriftRow, AssetClassLite } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
```

Replace with:

```tsx
import CommentDialog from "./comment-dialog";
import BenchmarkSelector from "./benchmark-selector";
import AllocationDonut from "./allocation-donut";
import AllocationTable from "./allocation-table";
import AllocationDrillTable from "./allocation-drill-table";
import DriftChart from "./drift-chart";
import type { HouseholdAllocation, DriftRow, AssetClassLite } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import { colorForAssetClass, UNALLOCATED_COLOR } from "@/lib/investments/palette";
```

**Edit B** — add the drill state next to the existing `commentOpen` state. Find:

```tsx
  const [commentOpen, setCommentOpen] = useState(false);
  const hasComment = existingCommentBody.trim().length > 0;
```

Replace with:

```tsx
  const [commentOpen, setCommentOpen] = useState(false);
  const [drilledRowId, setDrilledRowId] = useState<string | null>(null);
  const hasComment = existingCommentBody.trim().length > 0;
```

**Edit C** — derive the drilled-view props from `drilledRowId`. Add directly below the `disclosure` line (just before the `return (`). Find:

```tsx
  const disclosure = disclosureParts.length > 0 ? `Investable assets only. Excludes ${disclosureParts.join("; ")}.` : "Investable assets only.";
```

Add these lines immediately after it:

```tsx

  const isUnallocatedDrill = drilledRowId === "__unallocated__";
  const drilledAssetClass = drilledRowId && !isUnallocatedDrill
    ? household.byAssetClass.find((b) => b.id === drilledRowId)
    : null;
  const benchmarkWeightForDrilled = drilledRowId && !isUnallocatedDrill
    ? benchmarkWeights.find((w) => w.assetClassId === drilledRowId)
    : undefined;
```

**Edit D** — replace the `<AllocationTable>` invocation with a conditional. Find:

```tsx
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
          <AllocationTable
            household={household}
            benchmarkWeights={benchmarkWeights}
            assetClasses={assetClasses}
          />
        </section>
```

Replace with:

```tsx
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
          {drilledRowId === null ? (
            <AllocationTable
              household={household}
              benchmarkWeights={benchmarkWeights}
              assetClasses={assetClasses}
              onRowClick={setDrilledRowId}
            />
          ) : isUnallocatedDrill ? (
            <AllocationDrillTable
              assetClassName="Unallocated"
              assetClassColor={UNALLOCATED_COLOR}
              currentPct={0}
              targetPct={null}
              contributions={household.unallocatedContributions}
              totalInClass={household.unallocatedValue}
              onBack={() => setDrilledRowId(null)}
              isUnallocated
            />
          ) : drilledAssetClass ? (
            <AllocationDrillTable
              assetClassName={drilledAssetClass.name}
              assetClassColor={colorForAssetClass({ sortOrder: drilledAssetClass.sortOrder })}
              currentPct={drilledAssetClass.pctOfClassified}
              targetPct={benchmarkWeightForDrilled ? benchmarkWeightForDrilled.weight : null}
              contributions={household.contributionsByAssetClass[drilledAssetClass.id] ?? []}
              totalInClass={drilledAssetClass.value}
              onBack={() => setDrilledRowId(null)}
            />
          ) : (
            <AllocationTable
              household={household}
              benchmarkWeights={benchmarkWeights}
              assetClasses={assetClasses}
              onRowClick={setDrilledRowId}
            />
          )}
        </section>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Run full vitest suite**

Run: `npx vitest run`
Expected: 439 tests pass.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`. Open `/clients/<id>/investments` for a client with several investable accounts and asset mix data. Verify:

1. Default view unchanged (three-column table with swatches, Current, Target).
2. Hovering an asset-class row shows the `bg-gray-800/60` highlight and cursor pointer.
3. Clicking an asset-class row swaps the left card in-place: back link, swatch + name, "Current X.X% · Target Y.Y%", then a four-column account table (Account · $ class · % class · % account) with a totals row.
4. If no benchmark is selected, Target line in the header is omitted.
5. Clicking "← All asset classes" returns to the default view.
6. Clicking the Unallocated row drills into the unallocated bucket. Header shows "Unallocated" with the gray swatch, no Target line. `% account` is 100.0% per row.
7. The donut and drift chart remain unchanged throughout.
8. Keyboard: Tab focus lands on rows; Enter or Space drills in.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/investments/allocation-table.tsx \
  src/app/\(app\)/clients/\[id\]/investments/investments-client.tsx
git commit -m "feat(investments): click asset-class row to drill into account contributions"
```

- [ ] **Step 7: Production build check**

Run: `npm run build`
Expected: ✓ Compiled successfully. No new route or error in the manifest.

---

# Summary of commits

Expected commit trail on `investments-allocation-drilldown` (after the existing design-spec commit):

1. `feat(investments): per-account contributions in household allocation rollup`
2. `feat(investments): threaded account names + AllocationDrillTable component`
3. `feat(investments): click asset-class row to drill into account contributions`

Then fast-forward merge to `main` + push, or open a PR — same workflow as Phase 1.
