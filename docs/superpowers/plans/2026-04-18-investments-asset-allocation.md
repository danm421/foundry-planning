# Investments Phase 1: Asset Allocation Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new Investments tab on the client plan pages with an Asset Allocation Report that compares the household's investable portfolio (cash / retirement / taxable accounts) against an advisor-selected model portfolio, with a donut, details table, drift chart, advisor comment, and PDF stub.

**Architecture:** Server component fetches scenario + accounts + allocations + model portfolios + asset classes + plan_settings, runs pure functions in `src/lib/investments/` to build a view model, passes it to a client component. Benchmark selection persists on `plan_settings.selected_benchmark_portfolio_id`. Advisor comments persist in a new generic `report_comments` table keyed by `(client_id, scenario_id, report_key)` so later reports can reuse it. Unresolvable accounts surface as an "Unallocated" bucket instead of being silently dropped.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, drizzle-orm, Chart.js 4 via react-chartjs-2, vitest.

**Design spec:** [docs/superpowers/specs/2026-04-18-investments-asset-allocation-design.md](../specs/2026-04-18-investments-asset-allocation-design.md)

**Branch:** `investments-report-asset-allocation` (already created, one commit = the design spec).

---

## Conventions used throughout

- **Typecheck:** `npx tsc --noEmit` — expected: no output, exit 0.
- **Unit tests:** `npx vitest run` — expected: all tests pass.
- **Build:** `npm run build` — expected: compiled successfully; run once before pushing.
- **Dev server:** `npm run dev` — used for manual smoke tests of UI.
- **Migrations:** raw SQL files in `src/db/migrations/`, numbered sequentially. Latest existing: `0025_client_life_expectancy.sql`, so next is `0026_*.sql`.
- **Scenario resolution:** everything in this feature runs against the base-case scenario — `scenarios` row where `is_base_case = true` for the client.
- **Org scoping:** `getOrgId()` from `src/lib/db-helpers.ts` returns the Clerk org/user id used for `firm_id`. Always used in server components + API routes.

---

# Phase 1a — Scaffold

## Task 1a.1: Add Investments nav tab and empty route shell

**Files:**
- Modify: `src/app/(app)/clients/[id]/layout.tsx` (add tab to the `tabs` array)
- Create: `src/app/(app)/clients/[id]/investments/page.tsx`
- Create: `src/app/(app)/clients/[id]/investments/investments-client.tsx`

- [ ] **Step 1: Add the Investments tab**

Edit `src/app/(app)/clients/[id]/layout.tsx`. Find the `tabs` array (around line 16) and add an entry:

```tsx
const tabs = [
  { label: "Details", href: "client-data" },
  { label: "Balance Sheet", href: "balance-sheet-report" },
  { label: "Cash Flow", href: "cashflow" },
  { label: "Investments", href: "investments" },
];
```

- [ ] **Step 2: Create the server-component route shell**

Create `src/app/(app)/clients/[id]/investments/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import InvestmentsClient from "./investments-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InvestmentsPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  return <InvestmentsClient clientId={id} />;
}
```

- [ ] **Step 3: Create the client-component shell with the three-column layout**

Create `src/app/(app)/clients/[id]/investments/investments-client.tsx`:

```tsx
"use client";

interface Props {
  clientId: string;
}

export default function InvestmentsClient({ clientId: _clientId }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <nav className="mb-1 text-xs uppercase tracking-wide text-gray-500">
            Reports / Investments / Asset Allocation
          </nav>
          <h2 className="text-xl font-bold uppercase tracking-wide text-gray-100">
            Asset Allocation Report
          </h2>
        </div>
        <div className="text-sm text-gray-400">Target Portfolio: —</div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
          <div className="text-xs text-gray-500">Loading…</div>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Portfolio</h3>
          <div className="text-xs text-gray-500">Loading…</div>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Drift vs Target</h3>
          <div className="text-xs text-gray-500">Loading…</div>
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
        <div className="flex gap-2">
          <button
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
            disabled
          >
            Download PDF
          </button>
          <button
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
            disabled
          >
            Advisor Comment
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 5: Smoke test**

Run: `npm run dev`
Navigate to `/clients/<any-client-id>/investments`. Expected: the tab appears highlighted, the three-column empty shell renders with "Loading…" placeholders and disabled buttons at the bottom.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/layout.tsx \
  src/app/\(app\)/clients/\[id\]/investments/page.tsx \
  src/app/\(app\)/clients/\[id\]/investments/investments-client.tsx
git commit -m "feat(investments): scaffold asset allocation report page and nav tab"
```

---

# Phase 1b — Allocation math + tests

All tests in this phase use vitest (already configured). Tests live next to the module in a `__tests__/` directory, matching existing patterns (see `src/lib/__tests__/` and `src/components/balance-sheet-report/__tests__/`).

## Task 1b.1: Deterministic color palette for asset classes

**Files:**
- Create: `src/lib/investments/palette.ts`
- Create: `src/lib/investments/__tests__/palette.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/investments/__tests__/palette.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { colorForAssetClass, UNALLOCATED_COLOR } from "../palette";

describe("colorForAssetClass", () => {
  it("returns the same color for the same sortOrder across calls", () => {
    const a = colorForAssetClass({ id: "x", sortOrder: 3 });
    const b = colorForAssetClass({ id: "y", sortOrder: 3 });
    expect(a).toBe(b);
  });

  it("returns different colors for different sortOrder values", () => {
    const a = colorForAssetClass({ id: "x", sortOrder: 0 });
    const b = colorForAssetClass({ id: "y", sortOrder: 1 });
    expect(a).not.toBe(b);
  });

  it("wraps around for sortOrder beyond the palette length", () => {
    const a = colorForAssetClass({ id: "x", sortOrder: 0 });
    // Palette has 12 colors; index 12 should equal index 0.
    const b = colorForAssetClass({ id: "y", sortOrder: 12 });
    expect(a).toBe(b);
  });

  it("exposes a distinct neutral color for the Unallocated bucket", () => {
    const c = colorForAssetClass({ id: "x", sortOrder: 0 });
    expect(UNALLOCATED_COLOR).not.toBe(c);
    expect(UNALLOCATED_COLOR).toMatch(/^#/);
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/lib/investments/__tests__/palette.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/investments/palette.ts`:

```ts
// 12-color palette drawn from Tailwind 500-range hues, chosen for high
// distinguishability on a dark surface. Keep length at 12 — tests pin this.
const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f43f5e", // rose
  "#84cc16", // lime
  "#6366f1", // indigo
  "#f97316", // orange
  "#06b6d4", // cyan
  "#a855f7", // purple
] as const;

export const UNALLOCATED_COLOR = "#6b7280"; // gray-500

export function colorForAssetClass(assetClass: { sortOrder: number }): string {
  const n = PALETTE.length;
  const idx = ((assetClass.sortOrder % n) + n) % n;
  return PALETTE[idx]!;
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npx vitest run src/lib/investments/__tests__/palette.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no output.

```bash
git add src/lib/investments/palette.ts src/lib/investments/__tests__/palette.test.ts
git commit -m "feat(investments): deterministic asset-class color palette with tests"
```

---

## Task 1b.2: Benchmark resolver (model portfolio → weights)

**Files:**
- Create: `src/lib/investments/benchmarks.ts`
- Create: `src/lib/investments/__tests__/benchmarks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/investments/__tests__/benchmarks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveBenchmark } from "../benchmarks";

const MODEL_PORTFOLIOS = [
  { id: "p1", name: "Conservative" },
  { id: "p2", name: "Aggressive" },
];

const ALLOCATIONS_BY_PORTFOLIO: Record<string, { assetClassId: string; weight: number }[]> = {
  p1: [
    { assetClassId: "ac-eq", weight: 0.4 },
    { assetClassId: "ac-bond", weight: 0.6 },
  ],
  p2: [
    { assetClassId: "ac-eq", weight: 0.8 },
    { assetClassId: "ac-intl", weight: 0.2 },
  ],
};

describe("resolveBenchmark", () => {
  it("returns the allocations of the matching portfolio", () => {
    const out = resolveBenchmark("p1", MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO);
    expect(out).toEqual([
      { assetClassId: "ac-eq", weight: 0.4 },
      { assetClassId: "ac-bond", weight: 0.6 },
    ]);
  });

  it("returns null when the portfolio id is unknown", () => {
    const out = resolveBenchmark("missing", MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO);
    expect(out).toBeNull();
  });

  it("returns null when the portfolio exists but has no allocations", () => {
    const out = resolveBenchmark("p1", MODEL_PORTFOLIOS, { p1: [], p2: ALLOCATIONS_BY_PORTFOLIO.p2! });
    expect(out).toBeNull();
  });

  it("returns null when the portfolio id is null / undefined", () => {
    expect(resolveBenchmark(null, MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO)).toBeNull();
    expect(resolveBenchmark(undefined, MODEL_PORTFOLIOS, ALLOCATIONS_BY_PORTFOLIO)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/lib/investments/__tests__/benchmarks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/investments/benchmarks.ts`:

```ts
export interface ModelPortfolioLite {
  id: string;
  name: string;
}

export interface AssetClassWeight {
  assetClassId: string;
  weight: number;
}

/**
 * Resolve an advisor-selected model portfolio to a list of (assetClassId, weight).
 * Returns null when the portfolio id is unknown, unset, or has no allocations.
 */
export function resolveBenchmark(
  portfolioId: string | null | undefined,
  portfolios: ModelPortfolioLite[],
  allocationsByPortfolio: Record<string, AssetClassWeight[]>,
): AssetClassWeight[] | null {
  if (!portfolioId) return null;
  const portfolio = portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) return null;
  const allocations = allocationsByPortfolio[portfolioId];
  if (!allocations || allocations.length === 0) return null;
  return allocations;
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npx vitest run src/lib/investments/__tests__/benchmarks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no output.

```bash
git add src/lib/investments/benchmarks.ts src/lib/investments/__tests__/benchmarks.test.ts
git commit -m "feat(investments): benchmark resolver pulling weights from a model portfolio"
```

---

## Task 1b.3: Account allocation resolver (growth-source chain)

**Files:**
- Create: `src/lib/investments/allocation.ts`
- Create: `src/lib/investments/__tests__/allocation-resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/investments/__tests__/allocation-resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAccountAllocation, type AccountLite, type PlanSettingsLite } from "../allocation";

const PLAN: PlanSettingsLite = {
  growthSourceTaxable: "custom",
  growthSourceCash: "custom",
  growthSourceRetirement: "custom",
  modelPortfolioIdTaxable: null,
  modelPortfolioIdCash: null,
  modelPortfolioIdRetirement: null,
};

const P1_ALLOCATIONS = [
  { assetClassId: "ac-eq", weight: 0.6 },
  { assetClassId: "ac-bond", weight: 0.4 },
];

const ACCOUNT_MIX = {
  "acct-mix": [
    { assetClassId: "ac-eq", weight: 0.7 },
    { assetClassId: "ac-bond", weight: 0.3 },
  ],
};

const MP_ALLOCATIONS = { p1: P1_ALLOCATIONS };

function mkAccount(overrides: Partial<AccountLite>): AccountLite {
  return {
    id: "acct",
    category: "taxable",
    growthSource: "custom",
    modelPortfolioId: null,
    ...overrides,
  };
}

describe("resolveAccountAllocation", () => {
  it("uses explicit asset_mix rows when growthSource = 'asset_mix'", () => {
    const out = resolveAccountAllocation(
      mkAccount({ id: "acct-mix", growthSource: "asset_mix" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({
      classified: [
        { assetClassId: "ac-eq", weight: 0.7 },
        { assetClassId: "ac-bond", weight: 0.3 },
      ],
    });
  });

  it("returns unallocated when asset_mix is selected but rows are missing", () => {
    const out = resolveAccountAllocation(
      mkAccount({ id: "no-rows", growthSource: "asset_mix" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });

  it("follows the portfolio for growthSource = 'model_portfolio'", () => {
    const out = resolveAccountAllocation(
      mkAccount({ growthSource: "model_portfolio", modelPortfolioId: "p1" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ classified: P1_ALLOCATIONS });
  });

  it("returns unallocated when model_portfolio is selected with an unknown id", () => {
    const out = resolveAccountAllocation(
      mkAccount({ growthSource: "model_portfolio", modelPortfolioId: "nope" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });

  it("returns unallocated for a 'custom' account (no portfolio at account or plan level)", () => {
    const out = resolveAccountAllocation(
      mkAccount({ growthSource: "custom" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });

  it("falls back to plan_settings model portfolio for growthSource = 'default' when category's plan entry is a model portfolio", () => {
    const out = resolveAccountAllocation(
      mkAccount({ category: "retirement", growthSource: "default" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      { ...PLAN, growthSourceRetirement: "model_portfolio", modelPortfolioIdRetirement: "p1" },
    );
    expect(out).toEqual({ classified: P1_ALLOCATIONS });
  });

  it("returns unallocated for growthSource = 'default' when the plan entry is also 'custom'", () => {
    const out = resolveAccountAllocation(
      mkAccount({ category: "cash", growthSource: "default" }),
      ACCOUNT_MIX,
      MP_ALLOCATIONS,
      PLAN,
    );
    expect(out).toEqual({ unallocated: true });
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/lib/investments/__tests__/allocation-resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/investments/allocation.ts`:

```ts
import type { AssetClassWeight } from "./benchmarks";

export type GrowthSource = "default" | "model_portfolio" | "custom" | "asset_mix";

export type AccountCategory =
  | "taxable"
  | "cash"
  | "retirement"
  | "real_estate"
  | "business"
  | "life_insurance";

export interface AccountLite {
  id: string;
  category: AccountCategory;
  growthSource: GrowthSource;
  modelPortfolioId: string | null;
}

export interface PlanSettingsLite {
  growthSourceTaxable: GrowthSource;
  growthSourceCash: GrowthSource;
  growthSourceRetirement: GrowthSource;
  modelPortfolioIdTaxable: string | null;
  modelPortfolioIdCash: string | null;
  modelPortfolioIdRetirement: string | null;
}

export type AccountAllocationResult =
  | { classified: AssetClassWeight[] }
  | { unallocated: true };

function planEntryForCategory(
  category: AccountCategory,
  plan: PlanSettingsLite,
): { source: GrowthSource; portfolioId: string | null } | null {
  if (category === "taxable")
    return { source: plan.growthSourceTaxable, portfolioId: plan.modelPortfolioIdTaxable };
  if (category === "cash")
    return { source: plan.growthSourceCash, portfolioId: plan.modelPortfolioIdCash };
  if (category === "retirement")
    return { source: plan.growthSourceRetirement, portfolioId: plan.modelPortfolioIdRetirement };
  return null;
}

/**
 * Resolve an account to a list of asset-class weights, walking the growth_source
 * chain: account.growthSource → (if "default") plan_settings category entry →
 * either explicit account_asset_allocations rows or a model portfolio's allocations.
 * Terminal "custom" or missing data → unallocated.
 */
export function resolveAccountAllocation(
  account: AccountLite,
  accountMixByAccountId: Record<string, AssetClassWeight[]>,
  modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]>,
  plan: PlanSettingsLite,
): AccountAllocationResult {
  if (account.growthSource === "asset_mix") {
    const rows = accountMixByAccountId[account.id];
    if (rows && rows.length > 0) return { classified: rows };
    return { unallocated: true };
  }

  if (account.growthSource === "model_portfolio") {
    if (!account.modelPortfolioId) return { unallocated: true };
    const rows = modelPortfolioAllocationsByPortfolioId[account.modelPortfolioId];
    if (rows && rows.length > 0) return { classified: rows };
    return { unallocated: true };
  }

  if (account.growthSource === "default") {
    const entry = planEntryForCategory(account.category, plan);
    if (!entry) return { unallocated: true };
    if (entry.source === "model_portfolio" && entry.portfolioId) {
      const rows = modelPortfolioAllocationsByPortfolioId[entry.portfolioId];
      if (rows && rows.length > 0) return { classified: rows };
    }
    return { unallocated: true };
  }

  // "custom" → no asset-class breakdown.
  return { unallocated: true };
}
```

- [ ] **Step 4: Run the tests — expect pass**

Run: `npx vitest run src/lib/investments/__tests__/allocation-resolve.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no output.

```bash
git add src/lib/investments/allocation.ts src/lib/investments/__tests__/allocation-resolve.test.ts
git commit -m "feat(investments): resolveAccountAllocation walks growth_source chain"
```

---

## Task 1b.4: Household allocation rollup

**Files:**
- Modify: `src/lib/investments/allocation.ts` (add `computeHouseholdAllocation` + types)
- Create: `src/lib/investments/__tests__/allocation-household.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/investments/__tests__/allocation-household.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeHouseholdAllocation,
  type AccountLite,
  type AccountAllocationResult,
} from "../allocation";

const ASSET_CLASSES = [
  { id: "ac-eq", name: "US Equity", sortOrder: 0 },
  { id: "ac-bond", name: "US Bonds", sortOrder: 1 },
];

function mkAccount(
  id: string,
  category: AccountLite["category"],
  value: number,
  ownerEntityId: string | null = null,
): AccountLite & { value: number; ownerEntityId: string | null } {
  return { id, category, growthSource: "custom", modelPortfolioId: null, value, ownerEntityId };
}

describe("computeHouseholdAllocation", () => {
  it("rolls dollar-weighted resolved allocations across investable accounts", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("a2", "retirement", 300_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      return {
        classified: [
          { assetClassId: "ac-eq", weight: 0.5 },
          { assetClassId: "ac-bond", weight: 0.5 },
        ],
      };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    // a1 → 100k US Equity. a2 → 150k US Equity + 150k US Bonds.
    // Classified total = 400k. Equity 250k (62.5%), Bond 150k (37.5%).
    expect(out.totalInvestableValue).toBe(400_000);
    expect(out.totalClassifiedValue).toBe(400_000);
    expect(out.unallocatedValue).toBe(0);
    expect(out.excludedNonInvestableValue).toBe(0);
    expect(out.byAssetClass).toEqual([
      { id: "ac-eq", name: "US Equity", sortOrder: 0, value: 250_000, pctOfClassified: 0.625 },
      { id: "ac-bond", name: "US Bonds", sortOrder: 1, value: 150_000, pctOfClassified: 0.375 },
    ]);
  });

  it("puts unallocated dollars into the unallocated bucket, not byAssetClass", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("a2", "cash", 50_000),
    ];
    const resolver = (acct: AccountLite): AccountAllocationResult => {
      if (acct.id === "a1") return { classified: [{ assetClassId: "ac-eq", weight: 1 }] };
      return { unallocated: true };
    };

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.totalInvestableValue).toBe(150_000);
    expect(out.totalClassifiedValue).toBe(100_000);
    expect(out.unallocatedValue).toBe(50_000);
    expect(out.byAssetClass).toEqual([
      { id: "ac-eq", name: "US Equity", sortOrder: 0, value: 100_000, pctOfClassified: 1 },
    ]);
  });

  it("excludes non-investable categories (business, real_estate, life_insurance) from the investable total", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("biz", "business", 500_000),
      mkAccount("home", "real_estate", 800_000),
      mkAccount("life", "life_insurance", 50_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.totalInvestableValue).toBe(100_000);
    expect(out.excludedNonInvestableValue).toBe(1_350_000);
  });

  it("excludes OOE (ownerEntityId set) accounts and counts them in excludedNonInvestableValue", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
      mkAccount("trust-held", "taxable", 250_000, "entity-1"),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });

    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);

    expect(out.totalInvestableValue).toBe(100_000);
    expect(out.excludedNonInvestableValue).toBe(250_000);
  });

  it("drops asset classes with zero rolled value from byAssetClass", () => {
    const accounts = [mkAccount("a1", "taxable", 100_000)];
    const resolver = (): AccountAllocationResult => ({
      classified: [{ assetClassId: "ac-eq", weight: 1 }],
    });
    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);
    // Only US Equity should appear; US Bonds has zero value.
    expect(out.byAssetClass.map((b) => b.id)).toEqual(["ac-eq"]);
  });

  it("sorts byAssetClass descending by value", () => {
    const accounts = [
      mkAccount("a1", "taxable", 100_000),
    ];
    const resolver = (): AccountAllocationResult => ({
      classified: [
        { assetClassId: "ac-bond", weight: 0.7 },
        { assetClassId: "ac-eq", weight: 0.3 },
      ],
    });
    const out = computeHouseholdAllocation(accounts, resolver, ASSET_CLASSES);
    expect(out.byAssetClass.map((b) => b.id)).toEqual(["ac-bond", "ac-eq"]);
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/lib/investments/__tests__/allocation-household.test.ts`
Expected: FAIL — `computeHouseholdAllocation` is not exported.

- [ ] **Step 3: Add the rollup**

Append the following to `src/lib/investments/allocation.ts`:

```ts
export interface AssetClassLite {
  id: string;
  name: string;
  sortOrder: number;
}

export interface InvestableAccount extends AccountLite {
  value: number;
  ownerEntityId: string | null;
}

export interface AssetClassRollup {
  id: string;
  name: string;
  sortOrder: number;
  value: number;
  pctOfClassified: number;
}

export interface HouseholdAllocation {
  byAssetClass: AssetClassRollup[];
  unallocatedValue: number;
  totalClassifiedValue: number;
  totalInvestableValue: number;
  excludedNonInvestableValue: number;
}

const INVESTABLE_CATEGORIES: ReadonlySet<AccountCategory> = new Set([
  "taxable",
  "cash",
  "retirement",
]);

/**
 * Roll up dollar-weighted resolved allocations across investable accounts.
 * "Investable" = category ∈ {taxable, cash, retirement} AND ownerEntityId is null.
 * Non-investable dollar totals are surfaced in excludedNonInvestableValue for
 * the disclosure line; unresolvable account dollars go into unallocatedValue.
 */
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

- [ ] **Step 4: Run the tests — expect pass**

Run: `npx vitest run src/lib/investments/__tests__/allocation-household.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no output.

```bash
git add src/lib/investments/allocation.ts src/lib/investments/__tests__/allocation-household.test.ts
git commit -m "feat(investments): household allocation rollup with investable filter"
```

---

## Task 1b.5: Drift computation (Current − Target union)

**Files:**
- Modify: `src/lib/investments/allocation.ts` (add `computeDrift`)
- Create: `src/lib/investments/__tests__/allocation-drift.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/investments/__tests__/allocation-drift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeDrift, type AssetClassRollup } from "../allocation";

const NAMES: Record<string, string> = {
  "ac-eq": "US Equity",
  "ac-bond": "US Bonds",
  "ac-intl": "Intl Equity",
};

function mkCurrent(entries: { id: string; pct: number }[]): AssetClassRollup[] {
  return entries.map((e, i) => ({
    id: e.id,
    name: NAMES[e.id] ?? e.id,
    sortOrder: i,
    value: e.pct * 100_000, // arbitrary, only pctOfClassified is used
    pctOfClassified: e.pct,
  }));
}

describe("computeDrift", () => {
  it("computes Current - Target for every asset class in either set", () => {
    const current = mkCurrent([
      { id: "ac-eq", pct: 0.7 },
      { id: "ac-bond", pct: 0.3 },
    ]);
    const target = [
      { assetClassId: "ac-eq", weight: 0.6 },
      { assetClassId: "ac-bond", weight: 0.4 },
    ];
    const out = computeDrift(current, target, NAMES);
    expect(out).toEqual([
      { assetClassId: "ac-eq", name: "US Equity", currentPct: 0.7, targetPct: 0.6, diffPct: 0.1 },
      { assetClassId: "ac-bond", name: "US Bonds", currentPct: 0.3, targetPct: 0.4, diffPct: -0.1 },
    ]);
  });

  it("treats missing side as zero (classes only in current)", () => {
    const current = mkCurrent([{ id: "ac-eq", pct: 1 }]);
    const target = [
      { assetClassId: "ac-eq", weight: 0.6 },
      { assetClassId: "ac-bond", weight: 0.4 },
    ];
    const out = computeDrift(current, target, NAMES);
    const bond = out.find((r) => r.assetClassId === "ac-bond")!;
    expect(bond.currentPct).toBe(0);
    expect(bond.targetPct).toBe(0.4);
    expect(bond.diffPct).toBeCloseTo(-0.4);
  });

  it("treats missing side as zero (classes only in target)", () => {
    const current = mkCurrent([
      { id: "ac-eq", pct: 0.5 },
      { id: "ac-intl", pct: 0.5 },
    ]);
    const target = [{ assetClassId: "ac-eq", weight: 1 }];
    const out = computeDrift(current, target, NAMES);
    const intl = out.find((r) => r.assetClassId === "ac-intl")!;
    expect(intl.currentPct).toBe(0.5);
    expect(intl.targetPct).toBe(0);
    expect(intl.diffPct).toBeCloseTo(0.5);
  });

  it("sorts results by absolute drift descending", () => {
    const current = mkCurrent([
      { id: "ac-eq", pct: 0.5 },
      { id: "ac-bond", pct: 0.3 },
      { id: "ac-intl", pct: 0.2 },
    ]);
    const target = [
      { assetClassId: "ac-eq", weight: 0.49 },
      { assetClassId: "ac-bond", weight: 0.5 },
      { assetClassId: "ac-intl", weight: 0.01 },
    ];
    const out = computeDrift(current, target, NAMES);
    const absDiffs = out.map((r) => Math.abs(r.diffPct));
    expect(absDiffs).toEqual([...absDiffs].sort((a, b) => b - a));
  });

  it("returns an empty array when target is empty", () => {
    const current = mkCurrent([{ id: "ac-eq", pct: 1 }]);
    const out = computeDrift(current, [], NAMES);
    // No target → drift vs nothing. Treat as "no meaningful comparison" → return [].
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npx vitest run src/lib/investments/__tests__/allocation-drift.test.ts`
Expected: FAIL — `computeDrift` is not exported.

- [ ] **Step 3: Add the drift function**

Append to `src/lib/investments/allocation.ts` (reusing the `AssetClassWeight` import already added in Task 1b.3 — do not add a second import):

```ts
export interface DriftRow {
  assetClassId: string;
  name: string;
  currentPct: number;
  targetPct: number;
  diffPct: number;
}

/**
 * Compute Current − Target drift per asset class over the union of classes
 * present in either side. Missing side is treated as 0. Sorts by |diff| desc.
 * Returns [] when target is empty (no benchmark selected).
 */
export function computeDrift(
  current: AssetClassRollup[],
  target: AssetClassWeight[],
  names: Record<string, string>,
): DriftRow[] {
  if (target.length === 0) return [];

  const ids = new Set<string>();
  for (const c of current) ids.add(c.id);
  for (const t of target) ids.add(t.assetClassId);

  const currentMap = new Map(current.map((c) => [c.id, c.pctOfClassified]));
  const targetMap = new Map(target.map((t) => [t.assetClassId, t.weight]));

  const rows: DriftRow[] = [];
  for (const id of ids) {
    const currentPct = currentMap.get(id) ?? 0;
    const targetPct = targetMap.get(id) ?? 0;
    rows.push({
      assetClassId: id,
      name: names[id] ?? id,
      currentPct,
      targetPct,
      diffPct: currentPct - targetPct,
    });
  }

  rows.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));
  return rows;
}
```

Remove the duplicate top-of-file import if it conflicts — the `AssetClassWeight` type alias is already imported earlier in the file (from Task 1b.3 Step 3). If your editor shows a duplicate-import warning, delete the extra `import type { AssetClassWeight as AssetClassWeightInput } ...` line and inline the type by using the existing `AssetClassWeight` name directly in `computeDrift`'s signature.

- [ ] **Step 4: Run the tests — expect pass**

Run: `npx vitest run src/lib/investments/__tests__/allocation-drift.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx vitest run`
Expected: all tests pass (palette + benchmarks + allocation-resolve + allocation-household + allocation-drift + preexisting).

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/investments/allocation.ts src/lib/investments/__tests__/allocation-drift.test.ts
git commit -m "feat(investments): drift computation over union of current and target"
```

---

# Phase 1c — Donut + allocation table + benchmark selector + migration

## Task 1c.1: Drizzle schema + SQL migration

**Files:**
- Modify: `src/db/schema.ts` (add `selectedBenchmarkPortfolioId` column, add `reportComments` table)
- Create: `src/db/migrations/0026_investments_report_schema.sql`
- Create: `src/db/migrations/meta/0026_snapshot.json` (generated)
- Modify: `src/db/migrations/meta/_journal.json` (generated)

- [ ] **Step 1: Edit schema.ts — add the plan_settings column**

Open `src/db/schema.ts`. Find the `planSettings` table definition (search for `export const planSettings = pgTable("plan_settings"`). Add `selectedBenchmarkPortfolioId` right above the existing `useCustomCma` line:

```ts
  selectedBenchmarkPortfolioId: uuid("selected_benchmark_portfolio_id").references(() => modelPortfolios.id, {
    onDelete: "set null",
  }),
  useCustomCma: boolean("use_custom_cma").notNull().default(false),
```

- [ ] **Step 2: Edit schema.ts — add the reportComments table**

In the same file, after the last existing `pgTable` definition (and before any `relations(...)` blocks), add:

```ts
export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("report_comments_client_scenario_key_unique").on(t.clientId, t.scenarioId, t.reportKey)],
);
```

- [ ] **Step 3: Generate the migration**

Run: `npx drizzle-kit generate`
Expected output includes: `Your SQL migration file ➜ src/db/migrations/0026_*.sql 🚀` (filename will have a random adjective — rename it to `0026_investments_report_schema.sql` in the next step if it isn't already that name).

- [ ] **Step 4: Rename migration if needed**

```bash
ls src/db/migrations/0026_*.sql
# if the generated filename isn't 0026_investments_report_schema.sql:
mv src/db/migrations/0026_<generated-name>.sql src/db/migrations/0026_investments_report_schema.sql
```

Then update `src/db/migrations/meta/_journal.json` — find the entry whose `tag` matches the old filename and change its `tag` to `"0026_investments_report_schema"`. (Drizzle regenerates this on next `generate`, but correct it now to keep history clean.)

- [ ] **Step 5: Apply the migration**

Run: `npx drizzle-kit migrate`
Expected: `changes applied` or similar success output; no errors.

- [ ] **Step 6: Typecheck + test suite**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run`
Expected: all tests pass (schema changes shouldn't affect the pure-logic tests from Phase 1b).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations/
git commit -m "feat(investments): schema + migration for benchmark selection and report_comments"
```

---

## Task 1c.2: Server component — fetch + compute view model

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/page.tsx`

- [ ] **Step 1: Replace page.tsx with the full data fetch**

Replace the entire contents of `src/app/(app)/clients/[id]/investments/page.tsx` with:

```tsx
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  scenarios,
  planSettings,
  accounts as accountsTable,
  accountAssetAllocations,
  assetClasses as assetClassesTable,
  modelPortfolios,
  modelPortfolioAllocations,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import {
  resolveAccountAllocation,
  computeHouseholdAllocation,
  computeDrift,
  type InvestableAccount,
  type AccountLite,
  type PlanSettingsLite,
  type AssetClassLite,
} from "@/lib/investments/allocation";
import { resolveBenchmark, type AssetClassWeight } from "@/lib/investments/benchmarks";
import InvestmentsClient from "./investments-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InvestmentsPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id: clientId } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) notFound();

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!scenario) notFound();

  const [settings] = await db
    .select()
    .from(planSettings)
    .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenario.id)));
  if (!settings) notFound();

  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows] = await Promise.all([
    db.select().from(accountsTable).where(and(eq(accountsTable.clientId, clientId), eq(accountsTable.scenarioId, scenario.id))),
    db.select().from(accountAssetAllocations),
    db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
  ]);

  // Index asset allocations by account id (filter to this client's accounts).
  const accountIds = new Set(acctRows.map((a) => a.id));
  const accountMixByAccountId: Record<string, AssetClassWeight[]> = {};
  for (const row of mixRows) {
    if (!accountIds.has(row.accountId)) continue;
    (accountMixByAccountId[row.accountId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  // Index model portfolio allocations by portfolio id.
  const modelPortfolioAllocationsByPortfolioId: Record<string, AssetClassWeight[]> = {};
  for (const row of portfolioAllocRows) {
    (modelPortfolioAllocationsByPortfolioId[row.modelPortfolioId] ??= []).push({
      assetClassId: row.assetClassId,
      weight: Number(row.weight),
    });
  }

  const planLite: PlanSettingsLite = {
    growthSourceTaxable: settings.growthSourceTaxable,
    growthSourceCash: settings.growthSourceCash,
    growthSourceRetirement: settings.growthSourceRetirement,
    modelPortfolioIdTaxable: settings.modelPortfolioIdTaxable ?? null,
    modelPortfolioIdCash: settings.modelPortfolioIdCash ?? null,
    modelPortfolioIdRetirement: settings.modelPortfolioIdRetirement ?? null,
  };

  const investableAccounts: InvestableAccount[] = acctRows.map((a) => ({
    id: a.id,
    category: a.category,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    value: Number(a.value),
    ownerEntityId: a.ownerEntityId ?? null,
  }));

  const assetClassLites: AssetClassLite[] = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
  }));

  const household = computeHouseholdAllocation(
    investableAccounts,
    (acct: AccountLite) =>
      resolveAccountAllocation(acct, accountMixByAccountId, modelPortfolioAllocationsByPortfolioId, planLite),
    assetClassLites,
  );

  const portfolioLites = portfolioRows.map((p) => ({ id: p.id, name: p.name }));
  const benchmark = resolveBenchmark(
    settings.selectedBenchmarkPortfolioId ?? null,
    portfolioLites,
    modelPortfolioAllocationsByPortfolioId,
  );

  const nameByClassId: Record<string, string> = {};
  for (const c of classRows) nameByClassId[c.id] = c.name;
  const drift = benchmark ? computeDrift(household.byAssetClass, benchmark, nameByClassId) : [];

  return (
    <InvestmentsClient
      clientId={clientId}
      household={household}
      drift={drift}
      assetClasses={assetClassLites}
      modelPortfolios={portfolioLites}
      selectedBenchmarkPortfolioId={settings.selectedBenchmarkPortfolioId ?? null}
      benchmarkWeights={benchmark ?? []}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors pointing at `InvestmentsClient` props that don't exist yet — that's expected; resolved in Task 1c.3.

- [ ] **Step 3: No commit yet**

Leave uncommitted; Task 1c.3 rewrites the client component signature to match.

---

## Task 1c.3: Client component — donut + allocation table + benchmark selector

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/investments-client.tsx`
- Create: `src/app/(app)/clients/[id]/investments/benchmark-selector.tsx`
- Create: `src/app/(app)/clients/[id]/investments/allocation-donut.tsx`
- Create: `src/app/(app)/clients/[id]/investments/allocation-table.tsx`

- [ ] **Step 1: Create the benchmark selector**

Create `src/app/(app)/clients/[id]/investments/benchmark-selector.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  clientId: string;
  modelPortfolios: { id: string; name: string }[];
  selectedBenchmarkPortfolioId: string | null;
}

export default function BenchmarkSelector({ clientId, modelPortfolios, selectedBenchmarkPortfolioId }: Props) {
  const [value, setValue] = useState<string>(selectedBenchmarkPortfolioId ?? "");
  const [saving, startTransition] = useTransition();
  const router = useRouter();

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    setValue(e.target.value);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedBenchmarkPortfolioId: next }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      console.error("Benchmark save failed:", err);
      setValue(selectedBenchmarkPortfolioId ?? "");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-2 text-sm text-gray-400">
      <span>Target Portfolio:</span>
      <select
        value={value}
        onChange={handleChange}
        disabled={saving}
        className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-gray-200"
      >
        <option value="">— Select —</option>
        {modelPortfolios.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Extend the plan-settings PUT route**

Open `src/app/api/clients/[id]/plan-settings/route.ts`. Find the `PUT` handler's destructured body (search for `const {`). Add `selectedBenchmarkPortfolioId` to the destructure list:

```ts
    const {
      // ... existing fields ...
      modelPortfolioIdRetirement,
      selectedBenchmarkPortfolioId,
    } = body;
```

Then, inside the `.set({ ... })` object passed to `db.update(planSettings)`, add the field right after `modelPortfolioIdRetirement`:

```ts
        modelPortfolioIdRetirement: modelPortfolioIdRetirement !== undefined ? modelPortfolioIdRetirement : undefined,
        selectedBenchmarkPortfolioId: "selectedBenchmarkPortfolioId" in body
          ? (selectedBenchmarkPortfolioId === null ? null : selectedBenchmarkPortfolioId)
          : undefined,
        updatedAt: new Date(),
```

- [ ] **Step 3: Create the donut component**

Create `src/app/(app)/clients/[id]/investments/allocation-donut.tsx`:

```tsx
"use client";

import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { colorForAssetClass, UNALLOCATED_COLOR } from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  household: HouseholdAllocation;
}

export default function AllocationDonut({ household }: Props) {
  const rows = [
    ...household.byAssetClass.map((b) => ({
      label: b.name,
      value: b.value,
      color: colorForAssetClass({ sortOrder: b.sortOrder }),
    })),
    ...(household.unallocatedValue > 0
      ? [{ label: "Unallocated", value: household.unallocatedValue, color: UNALLOCATED_COLOR }]
      : []),
  ];

  const data = {
    labels: rows.map((r) => r.label),
    datasets: [
      {
        data: rows.map((r) => r.value),
        backgroundColor: rows.map((r) => r.color),
        borderColor: "#111827", // gray-900
        borderWidth: 2,
      },
    ],
  };

  const options = {
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; parsed: number }) =>
            `${ctx.label}: $${ctx.parsed.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        },
      },
    },
    cutout: "62%",
    maintainAspectRatio: true,
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">Investable Total</div>
      <div className="text-2xl font-bold text-gray-100">
        ${household.totalInvestableValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </div>
      <div className="h-64 w-64">
        <Doughnut data={data} options={options} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the allocation table**

Create `src/app/(app)/clients/[id]/investments/allocation-table.tsx`:

```tsx
"use client";

import { colorForAssetClass, UNALLOCATED_COLOR } from "@/lib/investments/palette";
import type { HouseholdAllocation } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";

interface Props {
  household: HouseholdAllocation;
  benchmarkWeights: AssetClassWeight[];
  assetClasses: { id: string; name: string; sortOrder: number }[];
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

export default function AllocationTable({ household, benchmarkWeights, assetClasses }: Props) {
  const currentById = new Map(household.byAssetClass.map((b) => [b.id, b.pctOfClassified]));
  const targetById = new Map(benchmarkWeights.map((w) => [w.assetClassId, w.weight]));
  const ids = new Set<string>([...currentById.keys(), ...targetById.keys()]);

  const rows = Array.from(ids)
    .map((id) => {
      const ac = assetClasses.find((c) => c.id === id);
      return {
        id,
        name: ac?.name ?? id,
        sortOrder: ac?.sortOrder ?? 0,
        current: currentById.get(id) ?? 0,
        target: targetById.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.current - a.current);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-gray-800 text-gray-500">
            <th className="px-2 py-2 font-medium">Asset Class</th>
            <th className="px-2 py-2 font-medium">Current</th>
            <th className="px-2 py-2 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const color = colorForAssetClass({ sortOrder: r.sortOrder });
            return (
              <tr key={r.id} className="border-b border-gray-900">
                <td className="px-2 py-2 text-gray-200">
                  <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                  {r.name}
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-800">
                      <div className="h-full" style={{ width: `${r.current * 100}%`, backgroundColor: color }} />
                    </div>
                    <span className="tabular-nums">{pct(r.current)}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-gray-200">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded bg-gray-800">
                      <div className="h-full" style={{ width: `${r.target * 100}%`, backgroundColor: color }} />
                    </div>
                    <span className="tabular-nums">{pct(r.target)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
          {household.unallocatedValue > 0 && (
            <tr className="italic text-gray-500">
              <td className="px-2 py-2">
                <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: UNALLOCATED_COLOR }} />
                Unallocated
              </td>
              <td className="px-2 py-2 tabular-nums">
                ${household.unallocatedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </td>
              <td className="px-2 py-2">—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Rewrite the client component to accept the full view model**

Replace `src/app/(app)/clients/[id]/investments/investments-client.tsx`:

```tsx
"use client";

import BenchmarkSelector from "./benchmark-selector";
import AllocationDonut from "./allocation-donut";
import AllocationTable from "./allocation-table";
import type { HouseholdAllocation, DriftRow, AssetClassLite } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";

interface Props {
  clientId: string;
  household: HouseholdAllocation;
  drift: DriftRow[];
  assetClasses: AssetClassLite[];
  modelPortfolios: { id: string; name: string }[];
  selectedBenchmarkPortfolioId: string | null;
  benchmarkWeights: AssetClassWeight[];
}

function formatDollars(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function InvestmentsClient({
  clientId,
  household,
  drift: _drift,
  assetClasses,
  modelPortfolios,
  selectedBenchmarkPortfolioId,
  benchmarkWeights,
}: Props) {
  const disclosureParts: string[] = [];
  if (household.excludedNonInvestableValue > 0) {
    disclosureParts.push(`$${formatDollars(household.excludedNonInvestableValue)} in business / real estate`);
  }
  if (household.unallocatedValue > 0) {
    disclosureParts.push(`$${formatDollars(household.unallocatedValue)} in accounts without an asset mix`);
  }
  const disclosure = disclosureParts.length > 0 ? `Investable assets only. Excludes ${disclosureParts.join("; ")}.` : "Investable assets only.";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <nav className="mb-1 text-xs uppercase tracking-wide text-gray-500">
            Reports / Investments / Asset Allocation
          </nav>
          <h2 className="text-xl font-bold uppercase tracking-wide text-gray-100">
            Asset Allocation Report
          </h2>
        </div>
        <BenchmarkSelector
          clientId={clientId}
          modelPortfolios={modelPortfolios}
          selectedBenchmarkPortfolioId={selectedBenchmarkPortfolioId}
        />
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
          <AllocationTable
            household={household}
            benchmarkWeights={benchmarkWeights}
            assetClasses={assetClasses}
          />
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <AllocationDonut household={household} />
          <p className="mt-3 text-center text-xs text-gray-500">{disclosure}</p>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Drift vs Target</h3>
          <div className="text-xs text-gray-500">
            {selectedBenchmarkPortfolioId ? "Coming in Phase 1d" : "Select a target portfolio to see drift."}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
        <div className="flex gap-2">
          <button className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700" disabled>
            Download PDF
          </button>
          <button className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700" disabled>
            Advisor Comment
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 7: Smoke test**

Run: `npm run dev`. Open `/clients/<id>/investments`. Expected:
- Header with the benchmark dropdown.
- Left column shows an allocation table.
- Center column shows the donut + investable total + disclosure.
- Right column shows the "Select a target portfolio" empty state until the dropdown is set.
- Selecting a portfolio triggers a refresh and populates the Target column on the left table.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/investments/ src/app/api/clients/\[id\]/plan-settings/route.ts
git commit -m "feat(investments): donut, allocation table, and persistent benchmark selector"
```

---

# Phase 1d — Drift chart

## Task 1d.1: Horizontal diverging-bars drift chart

**Files:**
- Create: `src/app/(app)/clients/[id]/investments/drift-chart.tsx`
- Modify: `src/app/(app)/clients/[id]/investments/investments-client.tsx` (use the new chart)

- [ ] **Step 1: Create the drift chart component**

Create `src/app/(app)/clients/[id]/investments/drift-chart.tsx`:

```tsx
"use client";

import { colorForAssetClass } from "@/lib/investments/palette";
import type { DriftRow, AssetClassLite } from "@/lib/investments/allocation";

interface Props {
  drift: DriftRow[];
  assetClasses: AssetClassLite[];
}

function pct(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

export default function DriftChart({ drift, assetClasses }: Props) {
  if (drift.length === 0) {
    return <div className="text-xs text-gray-500">Select a target portfolio to see drift.</div>;
  }

  const sortOrderById = new Map(assetClasses.map((c) => [c.id, c.sortOrder]));
  const max = Math.max(0.01, ...drift.map((r) => Math.abs(r.diffPct)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {drift.map((r) => {
          const widthPct = (Math.abs(r.diffPct) / max) * 50; // max bar = 50% of track width
          const isOver = r.diffPct >= 0;
          return (
            <div key={r.assetClassId} className="grid grid-cols-[120px_1fr_60px] items-center gap-2 text-xs">
              <span className="truncate text-gray-300">{r.name}</span>
              <div className="relative h-4 rounded bg-gray-800/60">
                <div className="absolute inset-y-0 left-1/2 w-px bg-gray-700" />
                <div
                  className="absolute inset-y-0 rounded"
                  style={{
                    left: isOver ? "50%" : `${50 - widthPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: isOver ? "#14b8a6" : "#f59e0b", // teal / amber
                  }}
                />
              </div>
              <span className={`tabular-nums text-right ${isOver ? "text-teal-400" : "text-amber-400"}`}>{pct(r.diffPct)}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-col gap-1 border-t border-gray-800 pt-3">
        {drift.map((r) => {
          const sortOrder = sortOrderById.get(r.assetClassId) ?? 0;
          const color = colorForAssetClass({ sortOrder });
          return (
            <div key={`legend-${r.assetClassId}`} className="flex items-center justify-between text-xs text-gray-400">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                {r.name}
              </span>
              <span className="tabular-nums">{pct(r.diffPct)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the drift chart into the client component**

Open `src/app/(app)/clients/[id]/investments/investments-client.tsx`. Add the import near the top:

```tsx
import DriftChart from "./drift-chart";
```

Remove the underscore-prefix on the `drift` destructure:

```tsx
  drift,
```

Replace the right-column section content (the `<section>` that currently reads "Drift vs Target") with:

```tsx
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Drift vs Target</h3>
          <DriftChart drift={drift} assetClasses={assetClasses} />
        </section>
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. With a target portfolio selected, the right column should render diverging horizontal bars: overweight classes (current > target) point right in teal, underweight classes point left in amber; value labels in the same color at the end. Below the chart, a compact (swatch · name · ±X.XX%) legend.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/investments/
git commit -m "feat(investments): horizontal diverging-bars drift chart"
```

---

# Phase 1e — Advisor comment dialog

## Task 1e.1: Report comments API route

**Files:**
- Create: `src/app/api/clients/[id]/report-comments/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/clients/[id]/report-comments/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, reportComments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

async function getBaseCaseScenarioId(clientId: string, firmId: string): Promise<string | null> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return null;
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  return scenario?.id ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const reportKey = request.nextUrl.searchParams.get("reportKey");
    if (!reportKey) return NextResponse.json({ error: "reportKey is required" }, { status: 400 });

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const [row] = await db
      .select()
      .from(reportComments)
      .where(and(
        eq(reportComments.clientId, id),
        eq(reportComments.scenarioId, scenarioId),
        eq(reportComments.reportKey, reportKey),
      ));

    return NextResponse.json(row ?? { body: "" });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/report-comments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const body = await request.json();
    const reportKey: string | undefined = body.reportKey;
    const commentBody: string | undefined = body.body;
    if (!reportKey) return NextResponse.json({ error: "reportKey is required" }, { status: 400 });
    if (typeof commentBody !== "string") return NextResponse.json({ error: "body must be a string" }, { status: 400 });

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const [existing] = await db
      .select()
      .from(reportComments)
      .where(and(
        eq(reportComments.clientId, id),
        eq(reportComments.scenarioId, scenarioId),
        eq(reportComments.reportKey, reportKey),
      ));

    if (existing) {
      const [updated] = await db
        .update(reportComments)
        .set({ body: commentBody, updatedAt: new Date() })
        .where(eq(reportComments.id, existing.id))
        .returning();
      return NextResponse.json(updated);
    }

    const [inserted] = await db
      .insert(reportComments)
      .values({ clientId: id, scenarioId, reportKey, body: commentBody })
      .returning();
    return NextResponse.json(inserted);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/report-comments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/clients/\[id\]/report-comments/route.ts
git commit -m "feat(investments): report_comments upsert API (GET/PUT by reportKey)"
```

---

## Task 1e.2: Advisor comment modal + dot indicator

**Files:**
- Create: `src/app/(app)/clients/[id]/investments/comment-dialog.tsx`
- Modify: `src/app/(app)/clients/[id]/investments/page.tsx` (fetch existing comment, pass to client)
- Modify: `src/app/(app)/clients/[id]/investments/investments-client.tsx` (props + button + dot)

- [ ] **Step 1: Create the comment dialog component**

Create `src/app/(app)/clients/[id]/investments/comment-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  reportKey: string;
  initialBody: string;
}

export default function CommentDialog({ open, onClose, clientId, reportKey, initialBody }: Props) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/report-comments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportKey, body }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      console.error("Comment save failed:", err);
      setSaving(false);
      return;
    }
    setSaving(false);
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
        <h3 className="mb-3 text-lg font-semibold text-gray-100">Advisor Comment</h3>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          className="w-full rounded border border-gray-700 bg-gray-800 p-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          placeholder="Notes for this report…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Fetch the existing comment in the server component**

Open `src/app/(app)/clients/[id]/investments/page.tsx`. Add to the import list:

```ts
import { reportComments } from "@/db/schema";
```

Inside the `Promise.all`, add a sixth query after the existing five:

```ts
  const [acctRows, mixRows, classRows, portfolioRows, portfolioAllocRows, commentRows] = await Promise.all([
    db.select().from(accountsTable).where(and(eq(accountsTable.clientId, clientId), eq(accountsTable.scenarioId, scenario.id))),
    db.select().from(accountAssetAllocations),
    db.select().from(assetClassesTable).where(eq(assetClassesTable.firmId, firmId)),
    db.select().from(modelPortfolios).where(eq(modelPortfolios.firmId, firmId)),
    db.select().from(modelPortfolioAllocations),
    db.select().from(reportComments).where(and(
      eq(reportComments.clientId, clientId),
      eq(reportComments.scenarioId, scenario.id),
      eq(reportComments.reportKey, "investments_asset_allocation"),
    )),
  ]);

  const existingCommentBody = commentRows[0]?.body ?? "";
```

Update the `<InvestmentsClient ... />` props to pass the comment:

```tsx
    <InvestmentsClient
      // ...existing props...
      existingCommentBody={existingCommentBody}
    />
```

- [ ] **Step 3: Wire the button, dot, and dialog in the client component**

Open `src/app/(app)/clients/[id]/investments/investments-client.tsx`. Add imports:

```tsx
import { useState } from "react";
import CommentDialog from "./comment-dialog";
```

Change the function from a plain component to one with state — mark it a client component is already done (first line is `"use client"`). Add the new prop to the `Props` interface:

```tsx
  existingCommentBody: string;
```

Add it to the destructured params:

```tsx
  existingCommentBody,
```

Inside the component, before the `return`, add:

```tsx
  const [commentOpen, setCommentOpen] = useState(false);
  const hasComment = existingCommentBody.trim().length > 0;
```

Replace the disabled Advisor Comment button with an active one + a dot indicator when a comment exists:

```tsx
          <button
            onClick={() => setCommentOpen(true)}
            className="relative rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Advisor Comment
            {hasComment && (
              <span className="absolute -right-1 -top-1 inline-block h-2 w-2 rounded-full bg-blue-400" />
            )}
          </button>
```

At the end of the returned JSX tree (just before the closing `</div>` of the root), render the dialog:

```tsx
      <CommentDialog
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
        clientId={clientId}
        reportKey="investments_asset_allocation"
        initialBody={existingCommentBody}
      />
```

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Smoke test**

Run: `npm run dev`. Open the investments page. Click Advisor Comment → the modal appears. Type something → Save → modal closes, dot appears on the button. Reload the page → dot persists, textarea prefills with the saved body. Click again → Cancel keeps the original body.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/investments/
git commit -m "feat(investments): advisor comment dialog with persistence and dot indicator"
```

---

# Phase 1f — PDF stub + disclosure polish + FUTURE_WORK

## Task 1f.1: Activate the Download PDF button as a stub

**Files:**
- Modify: `src/app/(app)/clients/[id]/investments/investments-client.tsx`

- [ ] **Step 1: Wire the PDF button to a TODO handler**

Find the disabled Download PDF button in `investments-client.tsx`. Replace it with an active stub:

```tsx
          <button
            onClick={() => {
              // TODO: real PDF export — see FUTURE_WORK.md "Plan PDF export".
              alert("PDF export is coming soon.");
            }}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Download PDF
          </button>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/investments/investments-client.tsx
git commit -m "feat(investments): Download PDF button stub with TODO handler"
```

---

## Task 1f.2: Update FUTURE_WORK.md

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Strike the Investments report row**

Open `docs/FUTURE_WORK.md`. Find the row in the "Suggested Order" table for item #5:

```
| 5 | Investments report (asset allocation) | 7 | 4 | 5 | 16 |
```

Change it to strike-through style (matching the existing convention for shipped items):

```
| ~~5~~ | ~~Investments report (asset allocation)~~ | — | — | — | SHIPPED |
```

- [ ] **Step 2: Delete the paragraph detail in the Reports section**

In the same file, find the bullet under "## Reports" that begins with `**Investments report (asset allocation)**`. Delete the entire bullet (the paragraph-level detail per AGENTS.md convention: "When you ship something listed, delete the entry.").

- [ ] **Step 3: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs: mark Investments report (Phase 1 asset allocation) as shipped"
```

---

## Task 1f.3: Final verification + build

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: `✓ Compiled successfully` (or Next 16's equivalent). No unresolved type errors, no missing-module errors.

- [ ] **Step 4: End-to-end smoke test**

Run: `npm run dev`. Navigate to a client with multiple investable accounts. Verify in order:
1. Investments tab appears and highlights when active.
2. Without a target selected: Current column populated, Target column shows 0% bars, drift chart shows empty state, disclosure line reflects real excluded and unallocated totals.
3. Select a target portfolio: page refreshes, Target column populates, drift chart renders.
4. Advisor Comment: opens modal, saves, dot indicator persists through reload.
5. Download PDF: shows the "coming soon" alert.
6. With a client whose investable accounts include an out-of-estate account: its dollars appear in the "excludes" disclosure, not in the donut.
7. With a client whose investable accounts include one with `growth_source = 'custom'`: its dollars appear in the Unallocated row + the disclosure.

- [ ] **Step 5: No commit**

Verification only.

---

# Summary of commits

Expected commit trail on `investments-report-asset-allocation` (after the already-present design-spec commit):

1. `feat(investments): scaffold asset allocation report page and nav tab`
2. `feat(investments): deterministic asset-class color palette with tests`
3. `feat(investments): benchmark resolver pulling weights from a model portfolio`
4. `feat(investments): resolveAccountAllocation walks growth_source chain`
5. `feat(investments): household allocation rollup with investable filter`
6. `feat(investments): drift computation over union of current and target`
7. `feat(investments): schema + migration for benchmark selection and report_comments`
8. `feat(investments): donut, allocation table, and persistent benchmark selector`
9. `feat(investments): horizontal diverging-bars drift chart`
10. `feat(investments): report_comments upsert API (GET/PUT by reportKey)`
11. `feat(investments): advisor comment dialog with persistence and dot indicator`
12. `feat(investments): Download PDF button stub with TODO handler`
13. `docs: mark Investments report (Phase 1 asset allocation) as shipped`

Then push the branch and (per repo workflow) open a PR or fast-forward merge to `main` after final review.
