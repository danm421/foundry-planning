# Balance Sheet Report Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `/clients/[id]/balance-sheet-report` into a three-panel advisor-facing report (Assets / Center charts / Liabilities) with an ownership view selector, YoY context, a light-themed PDF export, and an allocation donut + 5-year Assets-vs-Liabilities bar chart.

**Architecture:** A presentational view over the existing projection engine output. Pure functions (`ownership-filter`, `yoy`, `view-model`) convert `ProjectionYear` + filter selections into a `BalanceSheetViewModel` consumed by panel components. A parallel `@react-pdf/renderer` component tree renders the same data for PDF export; a shared `tokens.ts` module prevents screen/PDF drift.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, `chart.js` + `react-chartjs-2` (already installed), `@react-pdf/renderer` (new), `vitest`.

**Spec:** [docs/superpowers/specs/2026-04-18-balance-sheet-redesign-design.md](../specs/2026-04-18-balance-sheet-redesign-design.md)

---

## File structure

```
src/components/
  balance-sheet-report-view.tsx                            (rewrite — currently plain)
  balance-sheet-report/
    tokens.ts                                              (new — shared screen/PDF tokens)
    ownership-filter.ts                                    (new — pure, tested)
    yoy.ts                                                 (new — pure, tested)
    view-model.ts                                          (new — pure, tested)
    header-controls.tsx                                    (new)
    assets-panel.tsx                                       (new)
    liabilities-panel.tsx                                  (new)
    center-column.tsx                                      (new — KPIs + donut + bar chart)
    __tests__/
      ownership-filter.test.ts                             (new)
      yoy.test.ts                                          (new)
      view-model.test.ts                                   (new)
  balance-sheet-report-pdf/
    chart-to-image.ts                                      (new — canvas → PNG)
    balance-sheet-pdf-document.tsx                         (new — @react-pdf tree)

src/app/(app)/clients/[id]/balance-sheet-report/
  page.tsx                                                 (modify — pass ownership context)
  export-pdf/
    route.ts                                               (new — streams PDF blob)
```

---

## Conventions for this plan

- Run tests with `npx vitest run <file>` (the project has vitest installed).
- Run type check with `npx tsc --noEmit`.
- Run dev server for manual verification with `npm run dev`.
- After each task, commit with a focused message. Do **not** push — a final task pushes everything.
- TypeScript strict; no `any` — use `unknown` and narrow.
- Use the existing `fmt` currency helper pattern (`new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })`). A small `formatCurrency` util lives inside `view-model.ts` for reuse across panels; import it where needed.

---

## Task 1: Install `@react-pdf/renderer`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `npm install @react-pdf/renderer`
Expected: `package.json` and `package-lock.json` updated; `@react-pdf/renderer` listed under dependencies.

- [ ] **Step 2: Verify the package resolves and type-checks**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @react-pdf/renderer for balance sheet PDF export"
```

---

## Task 2: Design tokens (`tokens.ts`)

Shared palette consumed by both the screen view (Tailwind classes) and the PDF document (react-pdf `StyleSheet`). The screen theme defines Tailwind-compatible class strings; the PDF theme defines raw hex values for react-pdf.

**Files:**
- Create: `src/components/balance-sheet-report/tokens.ts`

- [ ] **Step 1: Create the tokens module**

```typescript
// src/components/balance-sheet-report/tokens.ts
//
// Shared design tokens for the balance sheet report. Used by both the
// on-screen view (via Tailwind classes) and the PDF document (via react-pdf
// StyleSheet) so the two can't drift apart.

export type AssetCategoryKey =
  | "cash"
  | "taxable"
  | "retirement"
  | "realEstate"
  | "business"
  | "lifeInsurance";

/** Human-readable category labels shown in the UI. */
export const CATEGORY_LABELS: Record<AssetCategoryKey, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  realEstate: "Real Estate",
  business: "Business",
  lifeInsurance: "Life Insurance",
};

/** Category order in the assets panel (left → top, right → bottom). */
export const CATEGORY_ORDER: AssetCategoryKey[] = [
  "cash",
  "taxable",
  "retirement",
  "realEstate",
  "business",
  "lifeInsurance",
];

/** Hex palette used by the donut chart (both themes) and PDF rendering. */
export const CATEGORY_HEX: Record<AssetCategoryKey, string> = {
  cash: "#10b981",        // emerald-500
  taxable: "#3b82f6",     // blue-500
  retirement: "#8b5cf6",  // violet-500
  realEstate: "#f59e0b",  // amber-500
  business: "#ec4899",    // pink-500
  lifeInsurance: "#14b8a6", // teal-500
};

/** Screen theme (dark). */
export const SCREEN_THEME = {
  surface: {
    panel: "bg-gray-900 border border-gray-800 rounded-lg",
    panelHeader: "bg-gradient-to-b from-gray-800/50 to-gray-900 px-4 py-3",
    divider: "border-gray-800",
    netWorthAccent: "bg-gradient-to-br from-blue-900/40 to-gray-900 border border-blue-800/50 shadow-[0_0_24px_rgba(59,130,246,0.15)]",
  },
  text: {
    primary: "text-gray-100",
    secondary: "text-gray-300",
    muted: "text-gray-500",
  },
  status: {
    up: "text-emerald-400 bg-emerald-950/50 border border-emerald-900",
    down: "text-rose-400 bg-rose-950/50 border border-rose-900",
    flat: "text-gray-400 bg-gray-800 border border-gray-700",
  },
} as const;

/** PDF theme (light, print-friendly). Raw hex values — react-pdf uses CSS-in-JS. */
export const PDF_THEME = {
  surface: {
    page: "#ffffff",
    panel: "#f8fafc",           // slate-50
    panelBorder: "#e2e8f0",     // slate-200
    panelHeader: "#f1f5f9",     // slate-100
    divider: "#e2e8f0",
    netWorthAccent: "#eff6ff",  // blue-50
    netWorthBorder: "#bfdbfe",  // blue-200
  },
  text: {
    primary: "#0f172a",   // slate-900
    secondary: "#334155", // slate-700
    muted: "#64748b",     // slate-500
  },
  status: {
    up: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },   // emerald
    down: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" }, // rose
    flat: { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" }, // slate
  },
} as const;
```

- [ ] **Step 2: Verify the file type-checks**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/balance-sheet-report/tokens.ts
git commit -m "feat(balance-sheet): add shared design tokens for screen+PDF"
```

---

## Task 3: `ownership-filter.ts` (TDD)

Pure filter applied to the raw accounts and liabilities lists. Drives what the Assets and Liabilities panels render, and also what the KPIs/donut/bar chart compute from. The spec's view-semantics table is the source of truth for this implementation.

**Files:**
- Create: `src/components/balance-sheet-report/ownership-filter.ts`
- Test: `src/components/balance-sheet-report/__tests__/ownership-filter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/balance-sheet-report/__tests__/ownership-filter.test.ts
import { describe, it, expect } from "vitest";
import { filterAccounts, filterLiabilities, type OwnershipView } from "../ownership-filter";

type Acc = { id: string; owner: "client" | "spouse" | "joint"; ownerEntityId?: string };
type Liab = { id: string; owner?: "client" | "spouse" | "joint"; ownerEntityId?: string };

const accounts: Acc[] = [
  { id: "a1", owner: "client" },
  { id: "a2", owner: "spouse" },
  { id: "a3", owner: "joint" },
  { id: "a4", owner: "client", ownerEntityId: "e1" },   // trust owned by client
  { id: "a5", owner: "joint", ownerEntityId: "e2" },    // LLC owned jointly
];

const liabilities: Liab[] = [
  { id: "l1", owner: "client" },
  { id: "l2", owner: "joint" },
  { id: "l3", owner: "spouse", ownerEntityId: "e1" },   // entity-owned liability
];

describe("filterAccounts", () => {
  const cases: Array<[OwnershipView, string[]]> = [
    ["consolidated", ["a1", "a2", "a3", "a4", "a5"]],
    ["client", ["a1"]],
    ["spouse", ["a2"]],
    ["joint", ["a3"]],
    ["entities", ["a4", "a5"]],
  ];

  for (const [view, expectedIds] of cases) {
    it(`returns the correct rows for view=${view}`, () => {
      const result = filterAccounts(accounts, view).map((a) => a.id);
      expect(result).toEqual(expectedIds);
    });
  }

  it("never leaks entity-owned rows into client/spouse/joint filters", () => {
    expect(filterAccounts(accounts, "client").some((a) => a.ownerEntityId)).toBe(false);
    expect(filterAccounts(accounts, "spouse").some((a) => a.ownerEntityId)).toBe(false);
    expect(filterAccounts(accounts, "joint").some((a) => a.ownerEntityId)).toBe(false);
  });
});

describe("filterLiabilities", () => {
  it("applies the same predicate shape as accounts", () => {
    expect(filterLiabilities(liabilities, "client").map((l) => l.id)).toEqual(["l1"]);
    expect(filterLiabilities(liabilities, "entities").map((l) => l.id)).toEqual(["l3"]);
    expect(filterLiabilities(liabilities, "consolidated").map((l) => l.id)).toEqual(["l1", "l2", "l3"]);
  });

  it("treats liabilities without an owner field as personal (fall through)", () => {
    const orphan: Liab = { id: "lx" };
    const result = filterLiabilities([orphan, ...liabilities], "consolidated");
    expect(result.map((l) => l.id)).toContain("lx");
    expect(filterLiabilities([orphan], "entities")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/balance-sheet-report/__tests__/ownership-filter.test.ts`
Expected: FAIL with "Cannot find module '../ownership-filter'".

- [ ] **Step 3: Implement `ownership-filter.ts`**

```typescript
// src/components/balance-sheet-report/ownership-filter.ts
export type OwnershipView =
  | "consolidated"
  | "client"
  | "spouse"
  | "joint"
  | "entities";

interface OwnedRow {
  owner?: "client" | "spouse" | "joint" | null;
  ownerEntityId?: string | null;
}

function isEntity(row: OwnedRow): boolean {
  return row.ownerEntityId != null;
}

function matchesPersonal(row: OwnedRow, target: "client" | "spouse" | "joint"): boolean {
  return !isEntity(row) && row.owner === target;
}

export function filterAccounts<T extends OwnedRow>(rows: T[], view: OwnershipView): T[] {
  switch (view) {
    case "consolidated":
      return rows;
    case "entities":
      return rows.filter(isEntity);
    case "client":
    case "spouse":
    case "joint":
      return rows.filter((r) => matchesPersonal(r, view));
  }
}

export function filterLiabilities<T extends OwnedRow>(rows: T[], view: OwnershipView): T[] {
  return filterAccounts(rows, view);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/balance-sheet-report/__tests__/ownership-filter.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/balance-sheet-report/ownership-filter.ts src/components/balance-sheet-report/__tests__/ownership-filter.test.ts
git commit -m "feat(balance-sheet): pure ownership filter for assets+liabilities"
```

---

## Task 4: `yoy.ts` (TDD)

Pure helpers for YoY % change and the 5-year bar-chart window.

**Files:**
- Create: `src/components/balance-sheet-report/yoy.ts`
- Test: `src/components/balance-sheet-report/__tests__/yoy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/balance-sheet-report/__tests__/yoy.test.ts
import { describe, it, expect } from "vitest";
import { yoyPct, sliceBarWindow } from "../yoy";

describe("yoyPct", () => {
  it("returns up badge for positive delta", () => {
    expect(yoyPct(1100, 1000)).toEqual({ value: 10, badge: "up" });
  });

  it("returns down badge for negative delta", () => {
    expect(yoyPct(900, 1000)).toEqual({ value: -10, badge: "down" });
  });

  it("returns flat badge within ±0.05% of zero", () => {
    expect(yoyPct(1000.3, 1000)).toEqual({ value: 0.03, badge: "flat" });
  });

  it("returns null when prior is null or undefined (no prior year)", () => {
    expect(yoyPct(1000, null)).toBeNull();
    expect(yoyPct(1000, undefined)).toBeNull();
  });

  it("returns null when prior is zero (avoid divide-by-zero)", () => {
    expect(yoyPct(1000, 0)).toBeNull();
  });
});

describe("sliceBarWindow", () => {
  const years = [2024, 2025, 2026, 2027, 2028, 2029, 2030];

  it("returns 2 before, selected, 2 after when fully inside", () => {
    expect(sliceBarWindow(years, 2027)).toEqual([2025, 2026, 2027, 2028, 2029]);
  });

  it("clamps at the start of the range", () => {
    expect(sliceBarWindow(years, 2024)).toEqual([2024, 2025, 2026]);
    expect(sliceBarWindow(years, 2025)).toEqual([2024, 2025, 2026, 2027]);
  });

  it("clamps at the end of the range", () => {
    expect(sliceBarWindow(years, 2030)).toEqual([2028, 2029, 2030]);
    expect(sliceBarWindow(years, 2029)).toEqual([2027, 2028, 2029, 2030]);
  });

  it("handles projections shorter than 5 years (no padding)", () => {
    expect(sliceBarWindow([2024, 2025, 2026], 2025)).toEqual([2024, 2025, 2026]);
    expect(sliceBarWindow([2024], 2024)).toEqual([2024]);
  });

  it("returns empty when selected year is not in the list", () => {
    expect(sliceBarWindow(years, 2099)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/balance-sheet-report/__tests__/yoy.test.ts`
Expected: FAIL with "Cannot find module '../yoy'".

- [ ] **Step 3: Implement `yoy.ts`**

```typescript
// src/components/balance-sheet-report/yoy.ts
export type YoyBadge = "up" | "down" | "flat";

export interface YoyResult {
  /** Percent change as a number (e.g. 10 = +10%). */
  value: number;
  badge: YoyBadge;
}

const FLAT_THRESHOLD = 0.05; // percent

export function yoyPct(
  current: number,
  prior: number | null | undefined,
): YoyResult | null {
  if (prior == null || prior === 0) return null;
  const value = ((current - prior) / Math.abs(prior)) * 100;
  let badge: YoyBadge;
  if (Math.abs(value) <= FLAT_THRESHOLD) badge = "flat";
  else if (value > 0) badge = "up";
  else badge = "down";
  return { value, badge };
}

/**
 * Return the list of years for the bar chart — 2 before / selected / 2 after,
 * clamped to the available projection years. If the selected year is not in
 * the list, returns an empty array.
 */
export function sliceBarWindow(years: number[], selected: number): number[] {
  const idx = years.indexOf(selected);
  if (idx < 0) return [];
  const start = Math.max(0, idx - 2);
  const end = Math.min(years.length, idx + 3); // inclusive of idx+2
  return years.slice(start, end);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/balance-sheet-report/__tests__/yoy.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/balance-sheet-report/yoy.ts src/components/balance-sheet-report/__tests__/yoy.test.ts
git commit -m "feat(balance-sheet): YoY percent + bar-window slicer"
```

---

## Task 5: `view-model.ts` (TDD)

Pure transformer: given a `ProjectionYear`, accounts list, liabilities list, entities list, and a selected `OwnershipView`, returns the `BalanceSheetViewModel` that panels and KPIs consume. Centralizes every derivation (filtered totals, category breakdowns, donut slices, bar-chart series, real-estate equity, mortgage-indicator flags) so panels stay presentational.

**Why this is the core of the feature:** when the ownership filter changes, the engine output doesn't change — the view model does. Panels re-render from the new view model. One function to test instead of testing four panels.

**Files:**
- Create: `src/components/balance-sheet-report/view-model.ts`
- Test: `src/components/balance-sheet-report/__tests__/view-model.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/balance-sheet-report/__tests__/view-model.test.ts
import { describe, it, expect } from "vitest";
import { buildViewModel, type BuildViewModelInput } from "../view-model";

// Minimal fixtures shaped like what /api/clients/[id]/projection-data returns,
// plus a shape-compatible ProjectionYear from the engine.

const accounts = [
  { id: "a-cash", name: "Joint Checking", category: "cash", owner: "joint" as const, ownerEntityId: null },
  { id: "a-401k", name: "John 401k", category: "retirement", owner: "client" as const, ownerEntityId: null },
  { id: "a-roth", name: "Jane Roth", category: "retirement", owner: "spouse" as const, ownerEntityId: null },
  { id: "a-home", name: "Primary Home", category: "real_estate", owner: "joint" as const, ownerEntityId: null },
  { id: "a-trust", name: "Family Trust Brokerage", category: "taxable", owner: "client" as const, ownerEntityId: "trust-1" },
];

const liabilities = [
  { id: "l-mort", name: "Primary Mortgage", owner: "joint" as const, ownerEntityId: null, linkedPropertyId: "a-home" },
  { id: "l-card", name: "Credit Card", owner: "client" as const, ownerEntityId: null, linkedPropertyId: null },
];

const projectionYear = {
  year: 2026,
  portfolioAssets: {
    cash: { "Joint Checking": 50_000 },
    taxable: { "Family Trust Brokerage": 300_000 },
    retirement: { "John 401k": 500_000, "Jane Roth": 200_000 },
    realEstate: { "Primary Home": 800_000 },
    business: {},
    lifeInsurance: {},
    cashTotal: 50_000,
    taxableTotal: 300_000,
    retirementTotal: 700_000,
    realEstateTotal: 800_000,
    businessTotal: 0,
    lifeInsuranceTotal: 0,
    total: 1_850_000,
  },
  liabilityBalancesBoY: { "l-mort": 400_000, "l-card": 8_000 },
};

const priorYear = {
  year: 2025,
  portfolioAssets: {
    ...projectionYear.portfolioAssets,
    total: 1_700_000,
    cash: { "Joint Checking": 45_000 },
    cashTotal: 45_000,
  },
  liabilityBalancesBoY: { "l-mort": 410_000, "l-card": 10_000 },
};

const baseInput: BuildViewModelInput = {
  accounts,
  liabilities,
  projectionYears: [priorYear, projectionYear],
  selectedYear: 2026,
  view: "consolidated",
};

describe("buildViewModel (consolidated)", () => {
  const vm = buildViewModel(baseInput);

  it("computes total assets across all categories including entity-owned", () => {
    expect(vm.totalAssets).toBe(1_850_000);
  });

  it("computes total liabilities across all owners", () => {
    expect(vm.totalLiabilities).toBe(408_000);
  });

  it("computes net worth = assets - liabilities", () => {
    expect(vm.netWorth).toBe(1_442_000);
  });

  it("returns categories in canonical order, zero-total categories excluded", () => {
    expect(vm.assetCategories.map((c) => c.key)).toEqual([
      "cash", "taxable", "retirement", "realEstate",
    ]);
  });

  it("includes an out-of-estate group with entity-owned accounts", () => {
    expect(vm.outOfEstateRows.map((r) => r.accountId)).toEqual(["a-trust"]);
    expect(vm.outOfEstateRows[0].value).toBe(300_000);
  });

  it("flags real estate rows that have a linked mortgage", () => {
    const re = vm.assetCategories.find((c) => c.key === "realEstate")!;
    const home = re.rows.find((r) => r.accountId === "a-home")!;
    expect(home.hasLinkedMortgage).toBe(true);
  });

  it("computes real estate equity = market value - linked mortgages", () => {
    expect(vm.realEstateEquity).toBe(400_000); // 800k home - 400k mortgage
  });

  it("computes YoY for total assets against the prior projection year", () => {
    expect(vm.yoy.totalAssets?.value).toBeCloseTo(((1_850_000 - 1_700_000) / 1_700_000) * 100, 2);
    expect(vm.yoy.totalAssets?.badge).toBe("up");
  });

  it("returns a donut slice per non-zero category with correct totals", () => {
    expect(vm.donut).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "cash", value: 50_000 }),
        expect.objectContaining({ key: "taxable", value: 300_000 }),
        expect.objectContaining({ key: "retirement", value: 700_000 }),
        expect.objectContaining({ key: "realEstate", value: 800_000 }),
      ]),
    );
    expect(vm.donut).toHaveLength(4);
  });
});

describe("buildViewModel (filtered views)", () => {
  it("client-only excludes entity-owned and other owners", () => {
    const vm = buildViewModel({ ...baseInput, view: "client" });
    expect(vm.outOfEstateRows).toEqual([]);
    const allRowAccountIds = vm.assetCategories.flatMap((c) => c.rows.map((r) => r.accountId));
    expect(allRowAccountIds).toEqual(["a-401k"]);
    expect(vm.totalAssets).toBe(500_000);
  });

  it("entities-only includes only entity-owned rows", () => {
    const vm = buildViewModel({ ...baseInput, view: "entities" });
    const allRowAccountIds = vm.assetCategories.flatMap((c) => c.rows.map((r) => r.accountId));
    expect(allRowAccountIds).toEqual(["a-trust"]);
    expect(vm.totalAssets).toBe(300_000);
    expect(vm.outOfEstateRows).toEqual([]); // entities view has no separate group
  });

  it("joint view includes the joint mortgage in liabilities", () => {
    const vm = buildViewModel({ ...baseInput, view: "joint" });
    expect(vm.liabilityRows.map((r) => r.liabilityId)).toEqual(["l-mort"]);
    expect(vm.totalLiabilities).toBe(400_000);
  });
});

describe("buildViewModel (edge cases)", () => {
  it("yoy is null for the first projection year", () => {
    const vm = buildViewModel({ ...baseInput, projectionYears: [projectionYear], selectedYear: 2026 });
    expect(vm.yoy.totalAssets).toBeNull();
    expect(vm.yoy.totalLiabilities).toBeNull();
    expect(vm.yoy.netWorth).toBeNull();
  });

  it("barChartSeries contains up to 5 entries centered on selected year", () => {
    const vm = buildViewModel(baseInput);
    expect(vm.barChartSeries.map((p) => p.year)).toEqual([2025, 2026]);
  });

  it("returns empty liabilityRows when client has no liabilities", () => {
    const vm = buildViewModel({ ...baseInput, liabilities: [], projectionYears: [priorYear, { ...projectionYear, liabilityBalancesBoY: {} }] });
    expect(vm.liabilityRows).toEqual([]);
    expect(vm.totalLiabilities).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/balance-sheet-report/__tests__/view-model.test.ts`
Expected: FAIL with "Cannot find module '../view-model'".

- [ ] **Step 3: Implement `view-model.ts`**

```typescript
// src/components/balance-sheet-report/view-model.ts
import { filterAccounts, filterLiabilities, type OwnershipView } from "./ownership-filter";
import { yoyPct, sliceBarWindow, type YoyResult } from "./yoy";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_HEX, type AssetCategoryKey } from "./tokens";

// ── Input shapes (loose — accept what /api/projection-data returns) ──────────

export interface AccountLike {
  id: string;
  name: string;
  category: string; // "cash" | "taxable" | "retirement" | "real_estate" | "business" | "life_insurance"
  owner: "client" | "spouse" | "joint";
  ownerEntityId?: string | null;
}

export interface LiabilityLike {
  id: string;
  name: string;
  owner?: "client" | "spouse" | "joint" | null;
  ownerEntityId?: string | null;
  linkedPropertyId?: string | null;
}

export interface ProjectionYearLike {
  year: number;
  portfolioAssets: {
    cash: Record<string, number>;
    taxable: Record<string, number>;
    retirement: Record<string, number>;
    realEstate: Record<string, number>;
    business: Record<string, number>;
    lifeInsurance: Record<string, number>;
    total: number;
  };
  liabilityBalancesBoY: Record<string, number>;
}

export interface BuildViewModelInput {
  accounts: AccountLike[];
  liabilities: LiabilityLike[];
  projectionYears: ProjectionYearLike[];
  selectedYear: number;
  view: OwnershipView;
}

// ── Output shape ─────────────────────────────────────────────────────────────

export interface AssetRow {
  accountId: string;
  accountName: string;
  owner: "client" | "spouse" | "joint";
  ownerEntityId: string | null;
  value: number;
  /** True when this is a real-estate row with a linked mortgage. */
  hasLinkedMortgage: boolean;
}

export interface AssetCategoryGroup {
  key: AssetCategoryKey;
  label: string;
  total: number;
  rows: AssetRow[];
  yoy: YoyResult | null;
}

export interface LiabilityRow {
  liabilityId: string;
  liabilityName: string;
  owner: "client" | "spouse" | "joint" | null;
  ownerEntityId: string | null;
  balance: number;
}

export interface DonutSlice {
  key: AssetCategoryKey;
  label: string;
  value: number;
  hex: string;
}

export interface BarChartPoint {
  year: number;
  assets: number;
  liabilities: number;
}

export interface BalanceSheetViewModel {
  selectedYear: number;
  assetCategories: AssetCategoryGroup[];
  outOfEstateRows: AssetRow[];
  liabilityRows: LiabilityRow[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  realEstateEquity: number;
  donut: DonutSlice[];
  barChartSeries: BarChartPoint[];
  yoy: {
    totalAssets: YoyResult | null;
    totalLiabilities: YoyResult | null;
    netWorth: YoyResult | null;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DB_TO_KEY: Record<string, AssetCategoryKey> = {
  cash: "cash",
  taxable: "taxable",
  retirement: "retirement",
  real_estate: "realEstate",
  business: "business",
  life_insurance: "lifeInsurance",
};

function categoryMap(
  yearData: ProjectionYearLike,
  key: AssetCategoryKey,
): Record<string, number> {
  return yearData.portfolioAssets[key];
}

function findPriorYear(
  projectionYears: ProjectionYearLike[],
  selectedYear: number,
): ProjectionYearLike | null {
  const idx = projectionYears.findIndex((y) => y.year === selectedYear);
  if (idx <= 0) return null;
  return projectionYears[idx - 1];
}

/**
 * Compute the filtered total for a single year by joining the projection's
 * per-account-name map against the account list filtered by view.
 */
function filteredAssetTotalForYear(
  yearData: ProjectionYearLike,
  accounts: AccountLike[],
  view: OwnershipView,
): number {
  const filtered = filterAccounts(accounts, view);
  const filteredNames = new Set(filtered.map((a) => a.name));
  let total = 0;
  for (const categoryKey of CATEGORY_ORDER) {
    const values = categoryMap(yearData, categoryKey);
    for (const [accountName, value] of Object.entries(values)) {
      if (filteredNames.has(accountName)) total += value;
    }
  }
  return total;
}

function filteredLiabilityTotalForYear(
  yearData: ProjectionYearLike,
  liabilities: LiabilityLike[],
  view: OwnershipView,
): number {
  const filtered = filterLiabilities(liabilities, view);
  const filteredIds = new Set(filtered.map((l) => l.id));
  let total = 0;
  for (const [id, balance] of Object.entries(yearData.liabilityBalancesBoY)) {
    if (filteredIds.has(id)) total += balance;
  }
  return total;
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildViewModel(input: BuildViewModelInput): BalanceSheetViewModel {
  const { accounts, liabilities, projectionYears, selectedYear, view } = input;

  const yearData = projectionYears.find((y) => y.year === selectedYear);
  if (!yearData) throw new Error(`Projection year ${selectedYear} not found`);

  const priorYear = findPriorYear(projectionYears, selectedYear);

  // Account lookup by name (projection keys by name).
  const accountByName = new Map(accounts.map((a) => [a.name, a]));

  // Liabilities linked to real-estate accounts → used for mortgage indicators
  // and real-estate equity.
  const mortgagesByPropertyId = new Map<string, LiabilityLike[]>();
  for (const liab of liabilities) {
    if (!liab.linkedPropertyId) continue;
    const list = mortgagesByPropertyId.get(liab.linkedPropertyId) ?? [];
    list.push(liab);
    mortgagesByPropertyId.set(liab.linkedPropertyId, list);
  }

  // ── Assets: grouped by category, filtered, with entity-owned split for consolidated view ──

  const filteredAccountIds = new Set(
    filterAccounts(accounts, view).map((a) => a.id),
  );

  const assetCategories: AssetCategoryGroup[] = [];
  const outOfEstateRows: AssetRow[] = [];

  for (const categoryKey of CATEGORY_ORDER) {
    const perAccountValues = categoryMap(yearData, categoryKey);
    const rows: AssetRow[] = [];
    const outRows: AssetRow[] = [];

    for (const [accountName, value] of Object.entries(perAccountValues)) {
      const acct = accountByName.get(accountName);
      if (!acct) continue; // projection output for an account not in our list (shouldn't happen)
      if (!filteredAccountIds.has(acct.id)) continue;

      const row: AssetRow = {
        accountId: acct.id,
        accountName,
        owner: acct.owner,
        ownerEntityId: acct.ownerEntityId ?? null,
        value,
        hasLinkedMortgage:
          categoryKey === "realEstate" &&
          (mortgagesByPropertyId.get(acct.id)?.length ?? 0) > 0,
      };

      if (view === "consolidated" && row.ownerEntityId != null) {
        outRows.push(row);
      } else {
        rows.push(row);
      }
    }

    const total = rows.reduce((sum, r) => sum + r.value, 0);
    const priorTotal = priorYear
      ? Object.entries(categoryMap(priorYear, categoryKey))
          .filter(([name]) => {
            const acct = accountByName.get(name);
            return acct && filteredAccountIds.has(acct.id) && (view !== "consolidated" || acct.ownerEntityId == null);
          })
          .reduce((sum, [, v]) => sum + v, 0)
      : null;

    if (total > 0 || rows.length > 0) {
      assetCategories.push({
        key: categoryKey,
        label: CATEGORY_LABELS[categoryKey],
        total,
        rows,
        yoy: yoyPct(total, priorTotal),
      });
    }

    outOfEstateRows.push(...outRows);
  }

  // ── Liabilities: flat list, filtered ──

  const filteredLiabIds = new Set(filterLiabilities(liabilities, view).map((l) => l.id));
  const liabilityRows: LiabilityRow[] = liabilities
    .filter((l) => filteredLiabIds.has(l.id))
    .map((l) => ({
      liabilityId: l.id,
      liabilityName: l.name,
      owner: l.owner ?? null,
      ownerEntityId: l.ownerEntityId ?? null,
      balance: yearData.liabilityBalancesBoY[l.id] ?? 0,
    }))
    .filter((r) => r.balance > 0);

  // ── Totals ──

  const totalAssets =
    assetCategories.reduce((sum, c) => sum + c.total, 0) +
    outOfEstateRows.reduce((sum, r) => sum + r.value, 0);
  const totalLiabilities = liabilityRows.reduce((sum, r) => sum + r.balance, 0);
  const netWorth = totalAssets - totalLiabilities;

  // ── Real estate equity = all filtered real-estate market value − linked mortgage balances ──

  const realEstateCategory = assetCategories.find((c) => c.key === "realEstate");
  const realEstateMarketValue =
    (realEstateCategory?.rows.reduce((sum, r) => sum + r.value, 0) ?? 0) +
    (view === "consolidated"
      ? outOfEstateRows
          .filter((r) => {
            const acct = accountByName.get(r.accountName);
            return acct && DB_TO_KEY[acct.category] === "realEstate";
          })
          .reduce((sum, r) => sum + r.value, 0)
      : 0);

  const linkedMortgageBalance = (realEstateCategory?.rows ?? [])
    .concat(view === "consolidated" ? outOfEstateRows : [])
    .flatMap((row) => mortgagesByPropertyId.get(row.accountId) ?? [])
    .reduce((sum, liab) => sum + (yearData.liabilityBalancesBoY[liab.id] ?? 0), 0);

  const realEstateEquity = realEstateMarketValue - linkedMortgageBalance;

  // ── Donut: one slice per non-zero asset category, including out-of-estate if consolidated ──

  const donut: DonutSlice[] = [];
  for (const cat of assetCategories) {
    let value = cat.total;
    if (view === "consolidated") {
      value += outOfEstateRows
        .filter((r) => {
          const acct = accountByName.get(r.accountName);
          return acct && DB_TO_KEY[acct.category] === cat.key;
        })
        .reduce((sum, r) => sum + r.value, 0);
    }
    if (value <= 0) continue;
    donut.push({
      key: cat.key,
      label: cat.label,
      value,
      hex: CATEGORY_HEX[cat.key],
    });
  }

  // ── Bar chart: 2 back / selected / 2 forward, values respecting the filter ──

  const allYears = projectionYears.map((y) => y.year);
  const windowYears = sliceBarWindow(allYears, selectedYear);
  const barChartSeries: BarChartPoint[] = windowYears.map((yr) => {
    const yData = projectionYears.find((y) => y.year === yr)!;
    return {
      year: yr,
      assets: filteredAssetTotalForYear(yData, accounts, view),
      liabilities: filteredLiabilityTotalForYear(yData, liabilities, view),
    };
  });

  // ── YoY ──

  const priorTotalAssets = priorYear
    ? filteredAssetTotalForYear(priorYear, accounts, view)
    : null;
  const priorTotalLiabilities = priorYear
    ? filteredLiabilityTotalForYear(priorYear, liabilities, view)
    : null;
  const priorNetWorth =
    priorTotalAssets != null && priorTotalLiabilities != null
      ? priorTotalAssets - priorTotalLiabilities
      : null;

  return {
    selectedYear,
    assetCategories,
    outOfEstateRows,
    liabilityRows,
    totalAssets,
    totalLiabilities,
    netWorth,
    realEstateEquity,
    donut,
    barChartSeries,
    yoy: {
      totalAssets: yoyPct(totalAssets, priorTotalAssets),
      totalLiabilities: yoyPct(totalLiabilities, priorTotalLiabilities),
      netWorth: yoyPct(netWorth, priorNetWorth),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/balance-sheet-report/__tests__/view-model.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/balance-sheet-report/view-model.ts src/components/balance-sheet-report/__tests__/view-model.test.ts
git commit -m "feat(balance-sheet): view model — projection → panels"
```

---

## Task 6: Header controls component

Top-of-page controls: title, AS OF year dropdown, View dropdown, Export PDF button.

**Files:**
- Create: `src/components/balance-sheet-report/header-controls.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/balance-sheet-report/header-controls.tsx
"use client";

import type { OwnershipView } from "./ownership-filter";

interface HeaderControlsProps {
  years: number[];
  selectedYear: number;
  onYearChange: (year: number) => void;
  view: OwnershipView;
  onViewChange: (view: OwnershipView) => void;
  /** Married clients with a spouse name. Hides the View selector entirely when false. */
  showViewSelector: boolean;
  /** Whether the "Entities only" option should appear in the View dropdown. */
  hasEntityAccounts: boolean;
  onExportPdf: () => void;
  exportInProgress: boolean;
}

const VIEW_LABELS: Record<OwnershipView, string> = {
  consolidated: "Consolidated",
  client: "Client only",
  spouse: "Spouse only",
  joint: "Joint only",
  entities: "Entities only",
};

export default function HeaderControls({
  years,
  selectedYear,
  onYearChange,
  view,
  onViewChange,
  showViewSelector,
  hasEntityAccounts,
  onExportPdf,
  exportInProgress,
}: HeaderControlsProps) {
  const viewOptions: OwnershipView[] = hasEntityAccounts
    ? ["consolidated", "client", "spouse", "joint", "entities"]
    : ["consolidated", "client", "spouse", "joint"];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight text-gray-100">Balance Sheet</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-400">
          AS OF
          <select
            value={selectedYear}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        {showViewSelector && (
          <label className="flex items-center gap-2 text-sm text-gray-400">
            View
            <select
              value={view}
              onChange={(e) => onViewChange(e.target.value as OwnershipView)}
              className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            >
              {viewOptions.map((v) => (
                <option key={v} value={v}>{VIEW_LABELS[v]}</option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={onExportPdf}
          disabled={exportInProgress}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exportInProgress ? "Exporting..." : "Export PDF"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/balance-sheet-report/header-controls.tsx
git commit -m "feat(balance-sheet): header controls (year/view/export)"
```

---

## Task 7: Assets panel component

Renders the `BalanceSheetViewModel.assetCategories` array plus the `outOfEstateRows` group (shown only in consolidated view).

**Files:**
- Create: `src/components/balance-sheet-report/assets-panel.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/balance-sheet-report/assets-panel.tsx
"use client";

import type { BalanceSheetViewModel, AssetRow, AssetCategoryGroup } from "./view-model";
import type { OwnershipView } from "./ownership-filter";
import { SCREEN_THEME, CATEGORY_HEX } from "./tokens";
import type { OwnerNames } from "@/lib/owner-labels";
import { individualOwnerLabel } from "@/lib/owner-labels";
import type { YoyResult } from "./yoy";

interface AssetsPanelProps {
  viewModel: BalanceSheetViewModel;
  view: OwnershipView;
  ownerNames: OwnerNames;
  showOwnerChips: boolean;
  entityLabelById: Map<string, string>;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function YoyBadge({ yoy }: { yoy: YoyResult | null }) {
  if (yoy == null) return null;
  const cls = SCREEN_THEME.status[yoy.badge];
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {arrow} {sign}{yoy.value.toFixed(1)}%
    </span>
  );
}

function OwnerChip({
  owner,
  ownerEntityId,
  names,
  entityLabelById,
}: {
  owner: AssetRow["owner"];
  ownerEntityId: string | null;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  const label = ownerEntityId
    ? entityLabelById.get(ownerEntityId) ?? "Entity"
    : individualOwnerLabel(owner, names);
  return (
    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
      {label}
    </span>
  );
}

function AccountRow({
  row,
  showOwnerChip,
  names,
  entityLabelById,
}: {
  row: AssetRow;
  showOwnerChip: boolean;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800/60 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2 text-sm text-gray-300">
        <span>{row.accountName}</span>
        {row.hasLinkedMortgage && (
          <span
            className="rounded border border-amber-800 bg-amber-950/50 px-1 text-[10px] font-medium uppercase text-amber-400"
            title="Has linked mortgage — see Liabilities"
          >
            M
          </span>
        )}
        {showOwnerChip && (
          <OwnerChip
            owner={row.owner}
            ownerEntityId={row.ownerEntityId}
            names={names}
            entityLabelById={entityLabelById}
          />
        )}
      </div>
      <span className="text-sm text-gray-200">{formatCurrency(row.value)}</span>
    </div>
  );
}

function CategoryCard({
  cat,
  showOwnerChips,
  names,
  entityLabelById,
}: {
  cat: AssetCategoryGroup;
  showOwnerChips: boolean;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  return (
    <div className={SCREEN_THEME.surface.panel}>
      <div className={`${SCREEN_THEME.surface.panelHeader} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: CATEGORY_HEX[cat.key] }}
          />
          <span className={`text-xs font-semibold uppercase tracking-wide ${SCREEN_THEME.text.secondary}`}>
            {cat.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${SCREEN_THEME.text.primary}`}>
            {formatCurrency(cat.total)}
          </span>
          <YoyBadge yoy={cat.yoy} />
        </div>
      </div>
      <div className="px-4 pb-3 pt-1">
        {cat.rows.map((row) => (
          <AccountRow
            key={row.accountId}
            row={row}
            showOwnerChip={showOwnerChips}
            names={names}
            entityLabelById={entityLabelById}
          />
        ))}
      </div>
    </div>
  );
}

export default function AssetsPanel({
  viewModel,
  view,
  ownerNames,
  showOwnerChips,
  entityLabelById,
}: AssetsPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Assets</h2>

      {viewModel.assetCategories.length === 0 && viewModel.outOfEstateRows.length === 0 && (
        <div className={`${SCREEN_THEME.surface.panel} p-6 text-center text-sm text-gray-500`}>
          No assets in this view.
        </div>
      )}

      {viewModel.assetCategories.map((cat) => (
        <CategoryCard
          key={cat.key}
          cat={cat}
          showOwnerChips={showOwnerChips}
          names={ownerNames}
          entityLabelById={entityLabelById}
        />
      ))}

      {view === "consolidated" && viewModel.outOfEstateRows.length > 0 && (
        <div className={SCREEN_THEME.surface.panel}>
          <div className={`${SCREEN_THEME.surface.panelHeader} flex items-center justify-between`}>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Out of Estate (Entity-owned)
            </span>
            <span className="text-sm font-semibold text-gray-100">
              {formatCurrency(viewModel.outOfEstateRows.reduce((s, r) => s + r.value, 0))}
            </span>
          </div>
          <div className="px-4 pb-3 pt-1">
            {viewModel.outOfEstateRows.map((row) => (
              <AccountRow
                key={row.accountId}
                row={row}
                showOwnerChip
                names={ownerNames}
                entityLabelById={entityLabelById}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/balance-sheet-report/assets-panel.tsx
git commit -m "feat(balance-sheet): assets panel w/ categories + out-of-estate group"
```

---

## Task 8: Liabilities panel component

Flat-list panel showing each filtered liability with owner chip and balance.

**Files:**
- Create: `src/components/balance-sheet-report/liabilities-panel.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/balance-sheet-report/liabilities-panel.tsx
"use client";

import type { BalanceSheetViewModel, LiabilityRow } from "./view-model";
import { SCREEN_THEME } from "./tokens";
import type { OwnerNames } from "@/lib/owner-labels";
import { individualOwnerLabel } from "@/lib/owner-labels";
import type { YoyResult } from "./yoy";

interface LiabilitiesPanelProps {
  viewModel: BalanceSheetViewModel;
  ownerNames: OwnerNames;
  showOwnerChips: boolean;
  entityLabelById: Map<string, string>;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function YoyBadge({ yoy }: { yoy: YoyResult | null }) {
  if (yoy == null) return null;
  const cls = SCREEN_THEME.status[yoy.badge];
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {arrow} {sign}{yoy.value.toFixed(1)}%
    </span>
  );
}

function LiabilityRowView({
  row,
  showOwnerChip,
  names,
  entityLabelById,
}: {
  row: LiabilityRow;
  showOwnerChip: boolean;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  const ownerLabel = row.ownerEntityId
    ? entityLabelById.get(row.ownerEntityId) ?? "Entity"
    : row.owner
      ? individualOwnerLabel(row.owner, names)
      : null;
  return (
    <div className="flex items-center justify-between border-b border-gray-800/60 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2 text-sm text-gray-300">
        <span>{row.liabilityName}</span>
        {showOwnerChip && ownerLabel && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
            {ownerLabel}
          </span>
        )}
      </div>
      <span className="text-sm text-gray-200">{formatCurrency(row.balance)}</span>
    </div>
  );
}

export default function LiabilitiesPanel({
  viewModel,
  ownerNames,
  showOwnerChips,
  entityLabelById,
}: LiabilitiesPanelProps) {
  const hasRows = viewModel.liabilityRows.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Liabilities &amp; Net Worth</h2>

      <div className={SCREEN_THEME.surface.panel}>
        <div className={`${SCREEN_THEME.surface.panelHeader} flex items-center justify-between`}>
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Total Liabilities
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100">
              {formatCurrency(viewModel.totalLiabilities)}
            </span>
            <YoyBadge yoy={viewModel.yoy.totalLiabilities} />
          </div>
        </div>
        <div className="px-4 pb-3 pt-1">
          {hasRows ? (
            viewModel.liabilityRows.map((row) => (
              <LiabilityRowView
                key={row.liabilityId}
                row={row}
                showOwnerChip={showOwnerChips}
                names={ownerNames}
                entityLabelById={entityLabelById}
              />
            ))
          ) : (
            <div className="py-2 text-center text-sm text-gray-500">No liabilities.</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/balance-sheet-report/liabilities-panel.tsx
git commit -m "feat(balance-sheet): liabilities panel"
```

---

## Task 9: Center column component (KPIs + donut + bar chart)

Stacks: Total Assets card → allocation donut → 5-year bar chart → Real Estate Equity (conditional) → Net Worth (accent).

**Files:**
- Create: `src/components/balance-sheet-report/center-column.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/balance-sheet-report/center-column.tsx
"use client";

import { useMemo, useRef, useEffect } from "react";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
} from "chart.js";
import type { BalanceSheetViewModel } from "./view-model";
import { SCREEN_THEME } from "./tokens";
import type { YoyResult } from "./yoy";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function YoyBadge({ yoy }: { yoy: YoyResult | null }) {
  if (yoy == null) return null;
  const cls = SCREEN_THEME.status[yoy.badge];
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {arrow} {sign}{yoy.value.toFixed(1)}%
    </span>
  );
}

interface CenterColumnProps {
  viewModel: BalanceSheetViewModel;
  /** Refs to the donut + bar chart canvases, used for PDF export capture. */
  donutCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  barCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export default function CenterColumn({
  viewModel,
  donutCanvasRef,
  barCanvasRef,
}: CenterColumnProps) {
  const donutData = useMemo(() => ({
    labels: viewModel.donut.map((s) => s.label),
    datasets: [{
      data: viewModel.donut.map((s) => s.value),
      backgroundColor: viewModel.donut.map((s) => s.hex),
      borderWidth: 0,
    }],
  }), [viewModel.donut]);

  const barData = useMemo(() => ({
    labels: viewModel.barChartSeries.map((p) => String(p.year)),
    datasets: [
      {
        label: "Total Assets",
        data: viewModel.barChartSeries.map((p) => p.assets),
        backgroundColor: "#3b82f6",
      },
      {
        label: "Total Liabilities",
        data: viewModel.barChartSeries.map((p) => p.liabilities),
        backgroundColor: "#f59e0b",
      },
    ],
  }), [viewModel.barChartSeries]);

  const donutRef = useRef<ChartJS<"doughnut"> | null>(null);
  const barRef = useRef<ChartJS<"bar"> | null>(null);

  // Expose canvas elements via the provided refs for PDF capture.
  useEffect(() => {
    if (donutRef.current && donutCanvasRef) {
      (donutCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current =
        donutRef.current.canvas;
    }
    if (barRef.current && barCanvasRef) {
      (barCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current =
        barRef.current.canvas;
    }
  });

  return (
    <div className="flex flex-col gap-4">
      <div className={`${SCREEN_THEME.surface.panel} p-5`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Total Assets
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="text-3xl font-bold text-gray-100">
            {formatCurrency(viewModel.totalAssets)}
          </div>
          <YoyBadge yoy={viewModel.yoy.totalAssets} />
        </div>
        {viewModel.donut.length > 0 && (
          <div className="mt-4 h-64">
            <Doughnut
              ref={donutRef}
              data={donutData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: "right",
                    labels: { color: "#9ca3af", boxWidth: 12, font: { size: 11 } },
                  },
                },
              }}
            />
          </div>
        )}
      </div>

      <div className={`${SCREEN_THEME.surface.panel} p-5`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Assets vs Liabilities
        </div>
        <div className="mt-3 h-48">
          <Bar
            ref={barRef}
            data={barData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  labels: { color: "#9ca3af", boxWidth: 12, font: { size: 11 } },
                },
              },
              scales: {
                x: { ticks: { color: "#9ca3af" }, grid: { display: false } },
                y: {
                  ticks: {
                    color: "#9ca3af",
                    callback: (v) => `$${(Number(v) / 1000).toFixed(0)}k`,
                  },
                  grid: { color: "rgba(75,85,99,0.2)" },
                },
              },
            }}
          />
        </div>
      </div>

      {viewModel.realEstateEquity > 0 && (
        <div className={`${SCREEN_THEME.surface.panel} p-4`}>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Real Estate Equity
          </div>
          <div className="mt-1 text-xl font-bold text-gray-100">
            {formatCurrency(viewModel.realEstateEquity)}
          </div>
        </div>
      )}

      <div className={`${SCREEN_THEME.surface.netWorthAccent} rounded-lg p-5`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-300">
          Net Worth
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="text-3xl font-bold text-gray-100">
            {formatCurrency(viewModel.netWorth)}
          </div>
          <YoyBadge yoy={viewModel.yoy.netWorth} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/balance-sheet-report/center-column.tsx
git commit -m "feat(balance-sheet): center column (KPIs + donut + bar chart)"
```

---

## Task 10: Rewrite `balance-sheet-report-view.tsx` + update `page.tsx`

Wire everything together. The view manages state (selected year, selected view, export-in-progress), fetches projection data, builds the view model, and renders the 3-column grid.

**Files:**
- Modify: `src/components/balance-sheet-report-view.tsx` (full rewrite)
- Modify: `src/app/(app)/clients/[id]/balance-sheet-report/page.tsx`

- [ ] **Step 1: Update `page.tsx` to pass ownership context**

Read the existing file first, then replace with:

```typescript
// src/app/(app)/clients/[id]/balance-sheet-report/page.tsx
import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getOrgId } from "@/lib/db-helpers";
import BalanceSheetReportView from "@/components/balance-sheet-report-view";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BalanceSheetReportPage({ params }: PageProps) {
  const firmId = await getOrgId();
  const { id } = await params;

  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

  if (!client) notFound();

  const entityRows = await db.select().from(entities).where(eq(entities.clientId, id));

  const isMarried =
    client.filingStatus === "married_joint" ||
    client.filingStatus === "married_separate";

  const ownerNames = {
    clientName: client.firstName ?? "Client",
    spouseName: client.spouseName ?? null,
  };

  const entityLabels = entityRows.map((e) => ({ id: e.id, name: e.id })); // entities schema has no name field in the portion we've seen; use id as placeholder label — if the schema has a name field, substitute it

  return (
    <BalanceSheetReportView
      clientId={id}
      isMarried={isMarried}
      ownerNames={ownerNames}
      entityLabels={entityLabels}
    />
  );
}
```

**Note for the implementer:** if the `entities` table has a human-readable `name` field, use it here (`e.name`) instead of `e.id`. Check `src/db/schema.ts` for the `entities` table definition — this is a 30-second fix, don't leave it as `e.id`.

- [ ] **Step 2: Rewrite `balance-sheet-report-view.tsx`**

```typescript
// src/components/balance-sheet-report-view.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear } from "@/engine/types";
import type { OwnerNames } from "@/lib/owner-labels";
import HeaderControls from "./balance-sheet-report/header-controls";
import AssetsPanel from "./balance-sheet-report/assets-panel";
import LiabilitiesPanel from "./balance-sheet-report/liabilities-panel";
import CenterColumn from "./balance-sheet-report/center-column";
import { buildViewModel } from "./balance-sheet-report/view-model";
import type { OwnershipView } from "./balance-sheet-report/ownership-filter";

interface EntityLabel { id: string; name: string }

interface BalanceSheetReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerNames: OwnerNames;
  entityLabels: EntityLabel[];
}

interface ProjectionApiResponse {
  accounts: Array<{ id: string; name: string; category: string; owner: "client" | "spouse" | "joint"; ownerEntityId?: string | null }>;
  liabilities: Array<{ id: string; name: string; owner?: "client" | "spouse" | "joint" | null; ownerEntityId?: string | null; linkedPropertyId?: string | null }>;
  // Passthrough — runProjection accepts the full response; we don't retype every field here.
  [key: string]: unknown;
}

export default function BalanceSheetReportView({
  clientId,
  isMarried,
  ownerNames,
  entityLabels,
}: BalanceSheetReportViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiData, setApiData] = useState<ProjectionApiResponse | null>(null);
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [view, setView] = useState<OwnershipView>("consolidated");
  const [exporting, setExporting] = useState(false);

  const donutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const projection = runProjection(data);
        setApiData(data);
        setProjectionYears(projection);
        if (projection.length > 0) setSelectedYear(projection[0].year);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId]);

  const hasEntityAccounts = useMemo(() => {
    return apiData?.accounts?.some((a) => a.ownerEntityId != null) ?? false;
  }, [apiData]);

  const entityLabelById = useMemo(() => {
    return new Map(entityLabels.map((e) => [e.id, e.name]));
  }, [entityLabels]);

  const viewModel = useMemo(() => {
    if (!apiData || selectedYear == null || projectionYears.length === 0) return null;
    return buildViewModel({
      accounts: apiData.accounts,
      liabilities: apiData.liabilities,
      projectionYears,
      selectedYear,
      view,
    });
  }, [apiData, projectionYears, selectedYear, view]);

  async function handleExportPdf() {
    if (!viewModel || !apiData || selectedYear == null) return;
    setExporting(true);
    try {
      const donutPng = donutCanvasRef.current?.toDataURL("image/png") ?? null;
      const barPng = barCanvasRef.current?.toDataURL("image/png") ?? null;

      const res = await fetch(
        `/api/clients/${clientId}/balance-sheet-report/export-pdf?year=${selectedYear}&view=${view}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ donutPng, barPng }),
        },
      );
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `balance-sheet-${selectedYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <div className="text-gray-400">Loading projection...</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/50 p-6 text-red-400">
        Error: {error}
      </div>
    );
  }
  if (!viewModel || projectionYears.length === 0 || selectedYear == null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HeaderControls
        years={projectionYears.map((y) => y.year)}
        selectedYear={selectedYear}
        onYearChange={setSelectedYear}
        view={view}
        onViewChange={setView}
        showViewSelector={isMarried || hasEntityAccounts}
        hasEntityAccounts={hasEntityAccounts}
        onExportPdf={handleExportPdf}
        exportInProgress={exporting}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr_1fr]">
        <AssetsPanel
          viewModel={viewModel}
          view={view}
          ownerNames={ownerNames}
          showOwnerChips={isMarried || hasEntityAccounts}
          entityLabelById={entityLabelById}
        />
        <CenterColumn
          viewModel={viewModel}
          donutCanvasRef={donutCanvasRef}
          barCanvasRef={barCanvasRef}
        />
        <LiabilitiesPanel
          viewModel={viewModel}
          ownerNames={ownerNames}
          showOwnerChips={isMarried || hasEntityAccounts}
          entityLabelById={entityLabelById}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 4: Smoke test in the browser**

Run: `npm run dev`
Expected: Start the dev server, open `/clients/<id>/balance-sheet-report` for an existing client, verify:
- Three panels render.
- Year selector lists projection years.
- View selector shows for married clients.
- Donut + bar chart render.
- YoY badges show on second year and later.

- [ ] **Step 5: Commit**

```bash
git add src/components/balance-sheet-report-view.tsx src/app/\(app\)/clients/\[id\]/balance-sheet-report/page.tsx
git commit -m "feat(balance-sheet): wire redesigned report view with ownership + charts"
```

---

## Task 11: `chart-to-image.ts` helper

Thin typed wrapper for turning a chart canvas into a data URL. Lives in the PDF folder because it's used only on the export path.

**Files:**
- Create: `src/components/balance-sheet-report-pdf/chart-to-image.ts`

- [ ] **Step 1: Create the helper**

```typescript
// src/components/balance-sheet-report-pdf/chart-to-image.ts
//
// Turns a chart.js canvas into a PNG data URL for embedding in react-pdf.
// Keep the logic trivial — complexity here would indicate we should be doing
// server-side chart rendering instead (we're not, for deployment simplicity).

export function canvasToPng(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch {
    // canvas.toDataURL can throw SecurityError on cross-origin contamination.
    // We control all canvases here, so this should never fire — but fail soft.
    return null;
  }
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/balance-sheet-report-pdf/chart-to-image.ts
git commit -m "feat(balance-sheet): canvas → PNG helper for PDF export"
```

---

## Task 12: PDF document component

Parallel react-pdf tree rendering the same view model in a light palette.

**Files:**
- Create: `src/components/balance-sheet-report-pdf/balance-sheet-pdf-document.tsx`

- [ ] **Step 1: Create the PDF document**

```typescript
// src/components/balance-sheet-report-pdf/balance-sheet-pdf-document.tsx
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { BalanceSheetViewModel } from "../balance-sheet-report/view-model";
import { PDF_THEME, CATEGORY_HEX } from "../balance-sheet-report/tokens";
import type { YoyResult } from "../balance-sheet-report/yoy";

interface PdfProps {
  clientName: string;
  asOfYear: number;
  viewLabel: string;
  generatedAt: string;
  viewModel: BalanceSheetViewModel;
  donutPng: string | null;
  barPng: string | null;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: PDF_THEME.surface.page,
    padding: 32,
    color: PDF_THEME.text.primary,
    fontFamily: "Helvetica",
    fontSize: 10,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.surface.divider,
    paddingBottom: 10,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "bold" },
  subtitle: { color: PDF_THEME.text.muted, fontSize: 10, marginTop: 2 },
  row: { flexDirection: "row", gap: 16 },
  column: { flex: 1, flexDirection: "column", gap: 10 },
  panel: {
    borderWidth: 1,
    borderColor: PDF_THEME.surface.panelBorder,
    backgroundColor: PDF_THEME.surface.panel,
    borderRadius: 4,
    padding: 10,
  },
  panelTitle: {
    fontSize: 9,
    textTransform: "uppercase",
    color: PDF_THEME.text.muted,
    marginBottom: 4,
  },
  bigValue: { fontSize: 16, fontWeight: "bold" },
  catHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_THEME.surface.divider,
  },
  netWorthCard: {
    borderWidth: 1,
    borderColor: PDF_THEME.surface.netWorthBorder,
    backgroundColor: PDF_THEME.surface.netWorthAccent,
    borderRadius: 4,
    padding: 12,
  },
  chartImage: { width: "100%", marginTop: 6 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 9,
    color: PDF_THEME.text.muted,
    textAlign: "center",
  },
  badge: {
    fontSize: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: 0.5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
});

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function Badge({ yoy }: { yoy: YoyResult | null }) {
  if (yoy == null) return null;
  const palette =
    yoy.badge === "up" ? PDF_THEME.status.up
    : yoy.badge === "down" ? PDF_THEME.status.down
    : PDF_THEME.status.flat;
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return (
    <Text style={[styles.badge, { color: palette.fg, backgroundColor: palette.bg, borderColor: palette.border }]}>
      {arrow} {sign}{yoy.value.toFixed(1)}%
    </Text>
  );
}

export function BalanceSheetPdfDocument({
  clientName,
  asOfYear,
  viewLabel,
  generatedAt,
  viewModel,
  donutPng,
  barPng,
}: PdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Balance Sheet — {clientName}</Text>
          <Text style={styles.subtitle}>
            As of {asOfYear} · {viewLabel} · Generated {generatedAt}
          </Text>
        </View>

        <View style={styles.row}>
          {/* Left: Assets */}
          <View style={styles.column}>
            <Text style={styles.panelTitle}>Assets</Text>
            {viewModel.assetCategories.map((cat) => (
              <View key={cat.key} style={styles.panel}>
                <View style={styles.catHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={[styles.dot, { backgroundColor: CATEGORY_HEX[cat.key] }]} />
                    <Text>{cat.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    <Text>{formatCurrency(cat.total)}</Text>
                    <Badge yoy={cat.yoy} />
                  </View>
                </View>
                {cat.rows.map((r) => (
                  <View key={r.accountId} style={styles.itemRow}>
                    <Text>{r.accountName}{r.hasLinkedMortgage ? " (M)" : ""}</Text>
                    <Text>{formatCurrency(r.value)}</Text>
                  </View>
                ))}
              </View>
            ))}
            {viewModel.outOfEstateRows.length > 0 && (
              <View style={styles.panel}>
                <Text style={{ marginBottom: 4 }}>Out of Estate (Entity-owned)</Text>
                {viewModel.outOfEstateRows.map((r) => (
                  <View key={r.accountId} style={styles.itemRow}>
                    <Text>{r.accountName}</Text>
                    <Text>{formatCurrency(r.value)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Center: totals + charts */}
          <View style={styles.column}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Total Assets</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.bigValue}>{formatCurrency(viewModel.totalAssets)}</Text>
                <Badge yoy={viewModel.yoy.totalAssets} />
              </View>
              {donutPng && <Image src={donutPng} style={styles.chartImage} />}
            </View>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Assets vs Liabilities</Text>
              {barPng && <Image src={barPng} style={styles.chartImage} />}
            </View>
            {viewModel.realEstateEquity > 0 && (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Real Estate Equity</Text>
                <Text>{formatCurrency(viewModel.realEstateEquity)}</Text>
              </View>
            )}
            <View style={styles.netWorthCard}>
              <Text style={styles.panelTitle}>Net Worth</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.bigValue}>{formatCurrency(viewModel.netWorth)}</Text>
                <Badge yoy={viewModel.yoy.netWorth} />
              </View>
            </View>
          </View>

          {/* Right: Liabilities */}
          <View style={styles.column}>
            <Text style={styles.panelTitle}>Liabilities &amp; Net Worth</Text>
            <View style={styles.panel}>
              <View style={styles.catHeader}>
                <Text>Total Liabilities</Text>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Text>{formatCurrency(viewModel.totalLiabilities)}</Text>
                  <Badge yoy={viewModel.yoy.totalLiabilities} />
                </View>
              </View>
              {viewModel.liabilityRows.length === 0 ? (
                <Text style={{ color: PDF_THEME.text.muted }}>No liabilities.</Text>
              ) : (
                viewModel.liabilityRows.map((r) => (
                  <View key={r.liabilityId} style={styles.itemRow}>
                    <Text>{r.liabilityName}</Text>
                    <Text>{formatCurrency(r.balance)}</Text>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/balance-sheet-report-pdf/balance-sheet-pdf-document.tsx
git commit -m "feat(balance-sheet): react-pdf document tree (light theme)"
```

---

## Task 13: Export PDF API route

Receives the chart PNGs from the client, rebuilds the view model server-side (never trust the client with balance-sheet dollars), streams the PDF.

**Files:**
- Create: `src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts`

**Note on location:** The spec draft put this route under `src/app/(app)/...` next to the page, but the rest of this project follows the `src/app/api/...` convention (see `src/app/api/clients/[id]/projection-data/route.ts`). Follow the project convention — place it under `src/app/api/`. The fetch URL in Task 10 is already aligned with this: `/api/clients/.../balance-sheet-report/export-pdf`.

- [ ] **Step 1: Create the route**

```typescript
// src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { runProjection } from "@/engine/projection";
import { renderToStream } from "@react-pdf/renderer";
import { BalanceSheetPdfDocument } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import { buildViewModel } from "@/components/balance-sheet-report/view-model";
import type { OwnershipView } from "@/components/balance-sheet-report/ownership-filter";
import React from "react";

const VIEW_LABELS: Record<OwnershipView, string> = {
  consolidated: "Consolidated",
  client: "Client only",
  spouse: "Spouse only",
  joint: "Joint only",
  entities: "Entities only",
};

function isOwnershipView(v: string): v is OwnershipView {
  return v === "consolidated" || v === "client" || v === "spouse" || v === "joint" || v === "entities";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const viewParam = url.searchParams.get("view") ?? "consolidated";
    if (!Number.isFinite(year)) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    if (!isOwnershipView(viewParam)) return NextResponse.json({ error: "Invalid view" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const donutPng: string | null = typeof body.donutPng === "string" ? body.donutPng : null;
    const barPng: string | null = typeof body.barPng === "string" ? body.barPng : null;

    // Pull projection data the same way the page does by hitting the API.
    // Using an internal fetch avoids duplicating the projection-data query.
    const apiRes = await fetch(`${url.origin}/api/clients/${id}/projection-data`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });
    if (!apiRes.ok) {
      return NextResponse.json({ error: "Failed to load projection data" }, { status: 500 });
    }
    const apiData = await apiRes.json();
    const projectionYears = runProjection(apiData);

    const viewModel = buildViewModel({
      accounts: apiData.accounts,
      liabilities: apiData.liabilities,
      projectionYears,
      selectedYear: year,
      view: viewParam,
    });

    const clientName = [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";
    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const doc = React.createElement(BalanceSheetPdfDocument, {
      clientName,
      asOfYear: year,
      viewLabel: VIEW_LABELS[viewParam],
      generatedAt,
      viewModel,
      donutPng,
      barPng,
    });

    const stream = await renderToStream(doc);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="balance-sheet-${(client.lastName ?? "client").toLowerCase()}-${year}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("POST balance-sheet export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Smoke test the export**

Run: `npm run dev`
In the browser on the balance-sheet-report page, click "Export PDF". Expected:
- A file `balance-sheet-<lastname>-<year>.pdf` downloads.
- Opens cleanly with a light background, three columns, donut + bar images visible, totals match the screen view.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/clients/\[id\]/balance-sheet-report/export-pdf/route.ts
git commit -m "feat(balance-sheet): export-pdf route with react-pdf render stream"
```

---

## Task 14: Full test + type + build check

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass (including the three new test files from Tasks 3–5).

- [ ] **Step 2: Run the type check**

Run: `npx tsc --noEmit`
Expected: Pass.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: Build succeeds. (This catches Next.js-specific issues that `tsc --noEmit` misses, e.g. client/server boundary violations, route file conventions, and RSC serialization problems.)

- [ ] **Step 4: Manual smoke test in the browser**

Run: `npm run dev` and walk through these cases for an existing client:
- **Married client with mix of owners:** Assets panel groups by category; owner chips show; View selector shows all options; switching to "Client only" narrows the data and the donut/bar update; YoY badges appear from year 2 onward.
- **Married client with an entity-owned account:** "Out of Estate" group shows at the bottom of Assets panel in Consolidated view; "Entities only" option appears in the View dropdown.
- **Client with a real estate account linked to a mortgage:** "M" badge appears on the real-estate row; Real Estate Equity KPI shows the correct number.
- **Client with no liabilities:** Liabilities panel shows "No liabilities" empty state; Net Worth still computes.
- **Single filer:** View selector is hidden; owner chips are hidden.
- **PDF export:** Downloaded PDF is light-themed, three-panel, totals match the screen view.

If any of these fail, open a fix commit before pushing.

- [ ] **Step 5: No commit (this task is verification only).**

---

## Task 15: Push the branch

**Files:** none.

- [ ] **Step 1: Push**

Run: `git push -u origin balance-sheet`
Expected: Branch pushed and tracking origin/balance-sheet.

- [ ] **Step 2: Confirm**

Run: `git log --oneline origin/balance-sheet...origin/main | cat`
Expected: Commits from Tasks 1–13 + the spec commit are listed.

---

## Self-review (plan → spec coverage)

Every spec line item must map to a task:

- ✅ Three-panel layout (Assets / Center / Liabilities) → Tasks 7, 8, 9, 10.
- ✅ Liabilities panel (currently missing) → Task 8.
- ✅ Allocation donut → Task 9.
- ✅ 5-year Assets-vs-Liabilities bar chart → Task 9.
- ✅ YoY % badges → Tasks 4 (`yoy.ts`), 5 (integrated into view model), rendered in 7/8/9.
- ✅ Ownership view selector (Consolidated/Client/Spouse/Joint/Entities) → Tasks 3, 6, 10. Entity-option-hidden-when-empty in Task 6. Single-filer hiding in Task 10.
- ✅ Real Estate Equity KPI → Task 5 (computation), Task 9 (rendering).
- ✅ Mortgage indicator badge on real-estate rows → Tasks 5 (flag), 7 (render).
- ✅ AS OF year-only selector → Task 6.
- ✅ Export PDF button → Task 6 (control), Task 10 (handler), Task 13 (route).
- ✅ Light-themed PDF via @react-pdf/renderer → Tasks 1, 2 (PDF_THEME), 12, 13.
- ✅ Shared design tokens between screen + PDF → Task 2.
- ✅ View semantics table (entity-never-leaks-to-personal, consolidated-includes-all) → Task 3 test cases.
- ✅ Projection shorter than 5 years handled → Task 4 test.
- ✅ No liabilities → empty state → Task 8.
- ✅ No real estate → equity KPI hidden → Task 9 conditional.
- ✅ Single filer → view selector + chips hidden → Task 10.
- ✅ Unit tests for pure functions → Tasks 3, 4, 5.
- ✅ New dependency `@react-pdf/renderer` → Task 1.

No Phase 2 work here; account history (Phase 2) has its own spec slot.

---

## Known placeholders / implementer notes (read before starting)

1. **Task 10 Step 1 — entity display labels.** The plan uses `e.id` as the entity label in `page.tsx` because I did not verify whether the `entities` table has a `name` column. Before running Task 10, open `src/db/schema.ts`, find the `entities` table, and check for a display-name column (likely `name`). If it exists, use it; if it doesn't, keep the id fallback and file a tiny follow-up. Do not leave this as "TODO" in the committed code — pick one and run.

2. **Task 13 — `params` is a promise.** Next.js 16 App Router passes `params` as a Promise. The route handler awaits it. This is correct for Next 16; do not "simplify" it to a plain object.

3. **Task 13 — internal fetch for projection data.** The route handler calls its own `/api/clients/[id]/projection-data` endpoint via `fetch(${url.origin}/...)`. This is a cheap way to avoid duplicating the projection-data query logic, at the cost of one internal HTTP hop. If this becomes a performance concern, the cleanup is to extract the projection-data query into a shared function in `src/lib/` and call it from both routes — but ship the fetch-based version first and optimize only if measured.
