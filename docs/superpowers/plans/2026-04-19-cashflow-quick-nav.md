# Cash Flow Quick-Nav Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dropdown at the top of the Cash Flow report that jumps between four views — Base Cash Flow, Withdrawals, Assets, Taxes — with URL-synced state for the three drill views.

**Architecture:** Pure-logic utils (view ↔ drillPath ↔ search param) in a new `.ts` module with colocated vitest tests. A stateless `<select>`-based `QuickNavDropdown` component. `CashFlowReport` owns the URL ↔ `drillPath` bridge using `useSearchParams` + `router.replace`. No new routes, no layout changes, no `TaxDetailModal` changes.

**Tech Stack:** Next.js 16.2.3 App Router, React 19, TypeScript, Tailwind CSS v4, Vitest for unit tests, native HTML `<select>`.

**Design spec:** [docs/superpowers/specs/2026-04-19-cashflow-quick-nav-design.md](../specs/2026-04-19-cashflow-quick-nav-design.md)

**Deviation from spec:** The spec lists a "unit test for `QuickNavDropdown` (renders four options…)" but this codebase has no React component rendering infrastructure (no `@testing-library/react`, no `jsdom`/`happy-dom` in `package.json`). Rather than introduce new test infrastructure out-of-scope, we fully cover the **logic** (view ↔ drillPath ↔ param mappings) with pure-function vitest tests, and verify the dropdown's rendering/click behavior via manual smoke test against the dev server. If component-rendering tests become standard in this codebase later, tests for `QuickNavDropdown` should be added.

---

## File Structure

**Create:**
- `src/components/cashflow/quick-nav-utils.ts` — pure helpers: `QuickNavView` type, `activeViewFromDrillPath`, `drillPathForView`, `viewFromSearchParam`, `searchParamForView`.
- `src/components/cashflow/__tests__/quick-nav-utils.test.ts` — vitest tests for the four helpers.
- `src/components/cashflow/quick-nav-dropdown.tsx` — presentational `<select>` component. Stateless. Props: `{ activeView, onSelectView, onOpenTaxes }`.

**Modify:**
- `src/components/cashflow-report.tsx`:
  - Add imports for `useSearchParams`, `useRouter`, `usePathname` from `next/navigation`, plus the new utils and dropdown.
  - Change `drillPath` state init (currently line 249: `useState<string[]>([])`) to lazy-init from the URL param.
  - Add a `handleSelectView` callback that updates both `drillPath` and the URL (via `router.replace`).
  - Add a `handleOpenTaxes` callback that calls `setShowTaxDetailModal(true)`.
  - Render `<QuickNavDropdown>` inside the existing report header, visually adjacent to the drill breadcrumb at ~line 1587.

---

## Task 1: Pure-logic utils + tests

**Files:**
- Create: `src/components/cashflow/quick-nav-utils.ts`
- Test: `src/components/cashflow/__tests__/quick-nav-utils.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/components/cashflow/__tests__/quick-nav-utils.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  activeViewFromDrillPath,
  drillPathForView,
  viewFromSearchParam,
  searchParamForView,
} from "../quick-nav-utils";

describe("activeViewFromDrillPath", () => {
  it("returns 'base' for an empty drillPath", () => {
    expect(activeViewFromDrillPath([])).toBe("base");
  });

  it("returns 'withdrawals' when drillPath[0] is 'cashflow'", () => {
    expect(activeViewFromDrillPath(["cashflow"])).toBe("withdrawals");
    expect(activeViewFromDrillPath(["cashflow", "detail"])).toBe("withdrawals");
  });

  it("returns 'assets' when drillPath[0] is 'portfolio'", () => {
    expect(activeViewFromDrillPath(["portfolio"])).toBe("assets");
    expect(activeViewFromDrillPath(["portfolio", "growth"])).toBe("assets");
  });

  it("returns 'base' for sub-drills of base (income, expenses, savings, growth, activity, other_income_detail)", () => {
    expect(activeViewFromDrillPath(["income"])).toBe("base");
    expect(activeViewFromDrillPath(["expenses"])).toBe("base");
    expect(activeViewFromDrillPath(["savings"])).toBe("base");
    expect(activeViewFromDrillPath(["growth"])).toBe("base");
    expect(activeViewFromDrillPath(["activity"])).toBe("base");
    expect(activeViewFromDrillPath(["other_income_detail"])).toBe("base");
  });

  it("returns 'base' for any unknown top segment", () => {
    expect(activeViewFromDrillPath(["something-else"])).toBe("base");
  });
});

describe("drillPathForView", () => {
  it("maps 'base' to []", () => {
    expect(drillPathForView("base")).toEqual([]);
  });

  it("maps 'withdrawals' to ['cashflow']", () => {
    expect(drillPathForView("withdrawals")).toEqual(["cashflow"]);
  });

  it("maps 'assets' to ['portfolio']", () => {
    expect(drillPathForView("assets")).toEqual(["portfolio"]);
  });
});

describe("viewFromSearchParam", () => {
  it("returns 'base' for null", () => {
    expect(viewFromSearchParam(null)).toBe("base");
  });

  it("returns 'withdrawals' for 'withdrawals'", () => {
    expect(viewFromSearchParam("withdrawals")).toBe("withdrawals");
  });

  it("returns 'assets' for 'assets'", () => {
    expect(viewFromSearchParam("assets")).toBe("assets");
  });

  it("returns 'base' for unknown or malformed values", () => {
    expect(viewFromSearchParam("")).toBe("base");
    expect(viewFromSearchParam("taxes")).toBe("base");
    expect(viewFromSearchParam("foo")).toBe("base");
    expect(viewFromSearchParam("WITHDRAWALS")).toBe("base"); // case-sensitive by design
  });
});

describe("searchParamForView", () => {
  it("returns null for 'base' (no param in URL)", () => {
    expect(searchParamForView("base")).toBeNull();
  });

  it("returns 'withdrawals' for 'withdrawals'", () => {
    expect(searchParamForView("withdrawals")).toBe("withdrawals");
  });

  it("returns 'assets' for 'assets'", () => {
    expect(searchParamForView("assets")).toBe("assets");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/components/cashflow/__tests__/quick-nav-utils.test.ts`

Expected: FAIL with module-resolution error (`Cannot find module '../quick-nav-utils'`) or similar.

- [ ] **Step 3: Implement the utils**

Create `src/components/cashflow/quick-nav-utils.ts` with:

```ts
export type QuickNavView = "base" | "withdrawals" | "assets";

export function activeViewFromDrillPath(drillPath: string[]): QuickNavView {
  const top = drillPath[0];
  if (top === "cashflow") return "withdrawals";
  if (top === "portfolio") return "assets";
  return "base";
}

export function drillPathForView(view: QuickNavView): string[] {
  switch (view) {
    case "withdrawals":
      return ["cashflow"];
    case "assets":
      return ["portfolio"];
    case "base":
      return [];
  }
}

export function viewFromSearchParam(param: string | null): QuickNavView {
  if (param === "withdrawals") return "withdrawals";
  if (param === "assets") return "assets";
  return "base";
}

export function searchParamForView(view: QuickNavView): string | null {
  return view === "base" ? null : view;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/components/cashflow/__tests__/quick-nav-utils.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/cashflow/quick-nav-utils.ts src/components/cashflow/__tests__/quick-nav-utils.test.ts
git commit -m "feat(cashflow): add quick-nav view↔drillPath↔param pure helpers"
```

---

## Task 2: `QuickNavDropdown` presentational component

**Files:**
- Create: `src/components/cashflow/quick-nav-dropdown.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/cashflow/quick-nav-dropdown.tsx` with:

```tsx
"use client";

import type { QuickNavView } from "./quick-nav-utils";

interface QuickNavDropdownProps {
  activeView: QuickNavView;
  onSelectView: (view: QuickNavView) => void;
  onOpenTaxes: () => void;
}

type DropdownValue = QuickNavView | "taxes";

const OPTIONS: { value: DropdownValue; label: string }[] = [
  { value: "base", label: "Base Cash Flow" },
  { value: "withdrawals", label: "Withdrawals" },
  { value: "assets", label: "Assets" },
  { value: "taxes", label: "Taxes" },
];

export function QuickNavDropdown({
  activeView,
  onSelectView,
  onOpenTaxes,
}: QuickNavDropdownProps) {
  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value as DropdownValue;
    if (value === "taxes") {
      onOpenTaxes();
      // Reset the select back to the active view so Taxes isn't stuck as the displayed value.
      event.target.value = activeView;
      return;
    }
    onSelectView(value);
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-300">
      <span className="text-slate-400">Jump to</span>
      <select
        aria-label="Jump to view"
        value={activeView}
        onChange={handleChange}
        className="bg-slate-800 border border-slate-600 text-slate-100 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

Notes for the engineer:

- The `value={activeView}` binding means the `<select>` always reflects the current view. Since `activeView` is one of `base | withdrawals | assets` (never `"taxes"`), the Taxes option is only ever reached via user selection, not via prop control.
- When the user picks Taxes, we call `onOpenTaxes()` and then reset `event.target.value` so the displayed option snaps back to the active view. This keeps the dropdown's visible state in sync with the underlying `activeView` (which doesn't change for Taxes).
- Tailwind palette chosen to match the existing `CashFlowReport` dark header (slate-800 background, slate-600 border). If the surrounding header uses different specific classes, mirror those instead — check the row near line 1587 in `cashflow-report.tsx` when wiring up.

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`

Expected: No errors from `src/components/cashflow/quick-nav-dropdown.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashflow/quick-nav-dropdown.tsx
git commit -m "feat(cashflow): add QuickNavDropdown presentational component"
```

---

## Task 3: Wire into `CashFlowReport`

**Files:**
- Modify: `src/components/cashflow-report.tsx`

This task integrates the dropdown. It has several distinct edits; keep them in one commit since they only make sense together.

- [ ] **Step 1: Add imports**

At the top of `src/components/cashflow-report.tsx`, add these imports alongside the existing ones (keep React, chart, engine, TaxDetailModal, YearRangeSlider imports as-is):

```ts
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  activeViewFromDrillPath,
  drillPathForView,
  viewFromSearchParam,
  searchParamForView,
  type QuickNavView,
} from "@/components/cashflow/quick-nav-utils";
import { QuickNavDropdown } from "@/components/cashflow/quick-nav-dropdown";
```

- [ ] **Step 2: Initialize `drillPath` from the URL + grab router/pathname**

Locate the `drillPath` state declaration (currently at line 249):

```ts
const [drillPath, setDrillPath] = useState<string[]>([]);
```

Replace it with:

```ts
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const [drillPath, setDrillPath] = useState<string[]>(() =>
  drillPathForView(viewFromSearchParam(searchParams?.get("view") ?? null))
);
```

The three `use*` hooks must appear before the `useState` that uses them, and must be inside the `CashFlowReport` function body (they are already because `CashFlowReport` is a client component).

Note: `useSearchParams()` may return `null` during SSR hydration in some Next.js configurations; the `?.get(...) ?? null` pattern handles that defensively. `viewFromSearchParam(null)` returns `"base"` so initial `drillPath` is `[]` in that case.

- [ ] **Step 3: Add the `handleSelectView` and `handleOpenTaxes` callbacks**

Directly after the `drillTo` function (currently ends at line 341), add:

```ts
  const activeView: QuickNavView = activeViewFromDrillPath(drillPath);

  function handleSelectView(view: QuickNavView) {
    setDrillPath(drillPathForView(view));
    const param = searchParamForView(view);
    const queryString = param ? `?view=${param}` : "";
    router.replace(`${pathname}${queryString}`, { scroll: false });
  }

  function handleOpenTaxes() {
    setShowTaxDetailModal(true);
  }
```

Notes:

- We compute `activeView` once per render from `drillPath` — no additional state needed.
- `router.replace` (not `.push`) so dropdown pivots don't stack history entries. `{ scroll: false }` prevents the Next.js App Router from scrolling to top on param change.
- The URL is intentionally only updated from the dropdown path; the existing `drillInto`/`drillTo` functions (which the table's `DrillBtn`s use) are left untouched — sub-drill navigation doesn't touch the URL per the spec.

- [ ] **Step 4: Render `<QuickNavDropdown>` in the report header**

Locate the drill breadcrumb JSX block (currently starts at line 1587, guarded by `{drillPath.length > 0 && (`). The breadcrumb only renders when drilled in; the dropdown should always render. Add a wrapper row that contains both.

Find this block:

```tsx
      {drillPath.length > 0 && (
        <nav className="..."> {/* breadcrumb */}
          ...
        </nav>
      )}
```

Replace it with:

```tsx
      <div className="flex items-center gap-4 flex-wrap">
        <QuickNavDropdown
          activeView={activeView}
          onSelectView={handleSelectView}
          onOpenTaxes={handleOpenTaxes}
        />
        {drillPath.length > 0 && (
          <nav className="..."> {/* breadcrumb — keep the existing inner JSX exactly */}
            ...
          </nav>
        )}
      </div>
```

Important: do not alter the inner JSX of the existing breadcrumb. Only wrap it in the new flex container and prepend the `<QuickNavDropdown>`. The engineer should open the file and copy the existing breadcrumb `<nav>` block verbatim into the new wrapper's second slot.

- [ ] **Step 5: Type-check and run the full test suite**

Run: `npx tsc --noEmit`

Expected: No type errors.

Run: `npm test`

Expected: All tests pass. Baseline was 445 passing tests before this feature; after Task 1's additions, the new baseline is 445 + 15 (the number of `it(...)` blocks added in `quick-nav-utils.test.ts`) = 460. Confirm the total matches.

- [ ] **Step 6: Commit**

```bash
git add src/components/cashflow-report.tsx
git commit -m "feat(cashflow): wire QuickNavDropdown into CashFlowReport with URL sync"
```

---

## Task 4: Manual smoke test + final verification

**Files:** (no file edits — verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Wait for: `Ready in N.Ns` log line. Open the browser at the URL shown (usually `http://localhost:3000`).

- [ ] **Step 2: Walk through the feature manually**

Navigate to a Cash Flow report page (`/clients/<id>/cashflow` for any existing client). Verify each of the following end-to-end behaviors:

1. Dropdown is visible at the top of the report, near the drill breadcrumb row.
2. Dropdown shows "Base Cash Flow" selected on initial load with no `?view=` param.
3. Select "Withdrawals" from the dropdown:
   - The report's drill state changes to the Net Cash Flow / Withdrawals view (the same columns that appear after clicking the "Net Cash Flow" drill button in the table).
   - The URL updates to include `?view=withdrawals` (no page reload, no scroll jump).
4. Select "Assets" from the dropdown:
   - The report shows the Portfolio / Assets drill (same columns as clicking the portfolio drill button in the table).
   - URL updates to `?view=assets`.
5. Select "Base Cash Flow" from the dropdown:
   - Report returns to the default view.
   - `?view=` param is removed from the URL.
6. Select "Taxes" from the dropdown:
   - `TaxDetailModal` opens over the current view.
   - URL does not change.
   - The dropdown's displayed label snaps back to the current view (e.g., "Withdrawals" if that was active before clicking Taxes).
7. Close the tax modal (existing close affordance) — confirm the underlying view is unchanged.
8. Reload the page at `?view=assets`: the Assets view loads directly, and the dropdown shows "Assets" selected.
9. Reload the page at `?view=bogus-value`: the base view loads, dropdown shows "Base Cash Flow", URL is not auto-cleaned (known acceptable per spec).
10. From the base view, drill into Income via the existing "Income" drill button: the URL stays at `/cashflow` with no `?view=` param (sub-drills do not touch the URL — this is per-spec).
11. Keyboard accessibility: Tab into the dropdown, Arrow keys change selection, Enter/Space (or click) commits.

- [ ] **Step 2a: Note any visual polish to defer**

If the dropdown visually looks off (spacing, colors that don't match the header theme exactly), apply minor Tailwind class tweaks inline. Anything more substantive (e.g., replacing the native `<select>` with a custom menu, adding icons) goes in `docs/FUTURE_WORK.md` with a one-line "Why deferred" note — per `AGENTS.md`.

- [ ] **Step 3: Stop the dev server**

Ctrl-C the `npm run dev` process.

- [ ] **Step 4: Full test run one more time**

Run: `npm test`

Expected: All tests pass, including baseline (445) + new utils tests.

- [ ] **Step 5: No commit needed for Task 4** unless Step 2a added inline polish. If polish was applied:

```bash
git add src/components/cashflow/quick-nav-dropdown.tsx
git commit -m "style(cashflow): polish QuickNavDropdown to match report header"
```

---

## Review Checklist

Before declaring the feature complete:

- [ ] All four tasks' commits land on branch `cashflow-quick-nav`.
- [ ] `npm test` passes cleanly.
- [ ] `npx tsc --noEmit` clean.
- [ ] Manual smoke test (Task 4, Step 2) all items confirmed.
- [ ] No commits modifying files outside `src/components/cashflow/`, `src/components/cashflow-report.tsx`, and `docs/superpowers/plans/…` / `docs/superpowers/specs/…` (spec + plan docs).
- [ ] `docs/FUTURE_WORK.md` updated only if something was consciously deferred during implementation (see Task 4 Step 2a, plus any post-hoc scope choices).

## Out-of-scope for this plan (per spec)

- Deep-linking the tax modal (`?view=taxes` auto-opens).
- URL persistence of sub-drill state (drillPath segments beyond the top).
- Converting `TaxDetailModal` into a proper drill state or route.
- Component-rendering tests for `QuickNavDropdown` (requires test infrastructure not present in this codebase).
