# Year-Range Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-handle year-range slider with Full / Working Years / Retirement Years presets to the top of the Cashflow Overview page; filter the chart, table, drill-downs, and Tax Detail modal to the selected window.

**Architecture:** Pure helpers (`year-range-utils.ts`) handle preset boundary computation, range clamping, and axis-label generation. A small Radix-based component (`year-range-slider.tsx`) renders the preset buttons + slider + axis labels. `cashflow-report.tsx` owns the range state and derives `visibleYears` to feed downstream consumers.

**Tech Stack:** TypeScript, React 19, Next.js 16, Tailwind CSS, vitest, `@radix-ui/react-slider` (new dep).

**Spec:** [docs/superpowers/specs/2026-04-16-year-range-slider-design.md](../specs/2026-04-16-year-range-slider-design.md)

---

## File Structure

```
src/components/cashflow/
  year-range-utils.ts                  CREATE — pure helpers (~80 lines)
  year-range-slider.tsx                CREATE — Radix slider + presets + axis (~120 lines)
  __tests__/
    year-range-utils.test.ts           CREATE — vitest helper tests (~150 lines)

src/components/cashflow-report.tsx     MODIFY (~20 lines)
  - Compute planStartYear, planEndYear, clientRetirementYear
  - Add useState for range, useEffect to reset on plan-bounds change
  - Mount <YearRangeSlider> at top
  - Replace `years` with `visibleYears` (filtered) in chart, table, and TaxDetailModal mount

package.json                            MODIFY (+1 dep: @radix-ui/react-slider)
```

---

## Task 1: Install Radix slider dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/danmueller/Desktop/foundry-planning-year-slider
npm install @radix-ui/react-slider
```

Expected: `package.json` gains `"@radix-ui/react-slider": "^1.x.x"` in dependencies; `package-lock.json` updated.

- [ ] **Step 2: Verify install worked**

```bash
ls node_modules/@radix-ui/react-slider/dist/index.mjs
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(slider): add @radix-ui/react-slider dependency"
```

---

## Task 2: `year-range-utils.ts` + tests (TDD)

Pure helper module. Computes preset boundaries, checks active preset, clamps a range, generates axis labels.

**Files:**
- Create: `src/components/cashflow/year-range-utils.ts`
- Create: `src/components/cashflow/__tests__/year-range-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/cashflow/__tests__/year-range-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  computePresets,
  isPresetActive,
  clampRange,
  computeAxisLabels,
} from "../year-range-utils";

describe("computePresets", () => {
  it("returns full = [planStart, planEnd] always", () => {
    const presets = computePresets(2026, 2076, 2040);
    expect(presets.full).toEqual([2026, 2076]);
  });

  it("with retirement year mid-projection: working ends day before retirement, retirement starts at retirement year", () => {
    const presets = computePresets(2026, 2076, 2040);
    expect(presets.working).toEqual([2026, 2039]);
    expect(presets.retirement).toEqual([2040, 2076]);
  });

  it("with retirement year at planStart: working = null, retirement = full", () => {
    const presets = computePresets(2026, 2076, 2026);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toEqual([2026, 2076]);
  });

  it("with retirement year before planStart: working = null, retirement = full", () => {
    const presets = computePresets(2026, 2076, 2020);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toEqual([2026, 2076]);
  });

  it("with retirement year after planEnd: working = full, retirement = null", () => {
    const presets = computePresets(2026, 2076, 2090);
    expect(presets.working).toEqual([2026, 2076]);
    expect(presets.retirement).toBeNull();
  });

  it("with retirement year at planEnd: working ends planEnd-1, retirement = [planEnd, planEnd]", () => {
    const presets = computePresets(2026, 2076, 2076);
    expect(presets.working).toEqual([2026, 2075]);
    expect(presets.retirement).toEqual([2076, 2076]);
  });

  it("with null retirement year: both working and retirement are null", () => {
    const presets = computePresets(2026, 2076, null);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toBeNull();
    expect(presets.full).toEqual([2026, 2076]);
  });

  it("for 1-year projection: full = [year, year]; working/retirement null when no retirement", () => {
    const presets = computePresets(2026, 2026, null);
    expect(presets.full).toEqual([2026, 2026]);
    expect(presets.working).toBeNull();
    expect(presets.retirement).toBeNull();
  });
});

describe("isPresetActive", () => {
  it("returns true on exact match", () => {
    expect(isPresetActive([2026, 2076], [2026, 2076])).toBe(true);
  });

  it("returns false when from differs", () => {
    expect(isPresetActive([2027, 2076], [2026, 2076])).toBe(false);
  });

  it("returns false when to differs", () => {
    expect(isPresetActive([2026, 2075], [2026, 2076])).toBe(false);
  });

  it("returns false when preset is null", () => {
    expect(isPresetActive([2026, 2076], null)).toBe(false);
  });
});

describe("clampRange", () => {
  it("returns range unchanged when within bounds", () => {
    expect(clampRange([2030, 2050], 2026, 2076)).toEqual([2030, 2050]);
  });

  it("clamps from up to min when below", () => {
    expect(clampRange([2020, 2050], 2026, 2076)).toEqual([2026, 2050]);
  });

  it("clamps to down to max when above", () => {
    expect(clampRange([2030, 2080], 2026, 2076)).toEqual([2030, 2076]);
  });

  it("swaps when from > to (defensive)", () => {
    expect(clampRange([2050, 2030], 2026, 2076)).toEqual([2030, 2050]);
  });

  it("preserves a collapsed range (from === to)", () => {
    expect(clampRange([2050, 2050], 2026, 2076)).toEqual([2050, 2050]);
  });

  it("returns [min, min] when both equal min", () => {
    expect(clampRange([2026, 2026], 2026, 2076)).toEqual([2026, 2026]);
  });
});

describe("computeAxisLabels", () => {
  it("returns 8 labels for a 50-year span by default", () => {
    const labels = computeAxisLabels(2026, 2076);
    expect(labels).toHaveLength(8);
    expect(labels[0]).toBe(2026);
    expect(labels[labels.length - 1]).toBe(2076);
  });

  it("returns labels in monotonically increasing order", () => {
    const labels = computeAxisLabels(2026, 2076);
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]).toBeGreaterThan(labels[i - 1]);
    }
  });

  it("returns deduped labels for short spans", () => {
    const labels = computeAxisLabels(2026, 2030);
    expect(labels).toEqual([2026, 2027, 2028, 2029, 2030]);
  });

  it("returns single label for 1-year span", () => {
    const labels = computeAxisLabels(2026, 2026);
    expect(labels).toEqual([2026]);
  });

  it("honors custom targetCount", () => {
    const labels = computeAxisLabels(2026, 2076, 5);
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe(2026);
    expect(labels[4]).toBe(2076);
  });

  it("always includes both endpoints exactly", () => {
    const labels = computeAxisLabels(2030, 2070, 6);
    expect(labels[0]).toBe(2030);
    expect(labels[labels.length - 1]).toBe(2070);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/components/cashflow/__tests__/year-range-utils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/cashflow/year-range-utils.ts`:

```typescript
export interface PresetWindows {
  full: [number, number];
  working: [number, number] | null;
  retirement: [number, number] | null;
}

/**
 * Compute the three preset windows for the year-range slider.
 *
 * Rules:
 * - full: always [planStart, planEnd]
 * - working: [planStart, retirementYear - 1] when retirementYear > planStart;
 *            null when retirementYear is null, ≤ planStart
 * - retirement: [retirementYear, planEnd] when retirementYear ≤ planEnd;
 *               null when retirementYear is null or > planEnd
 *
 * Edge cases:
 * - retirementYear at planStart → working = null, retirement = full
 * - retirementYear at planEnd → working = [planStart, planEnd - 1], retirement = [planEnd, planEnd]
 * - retirementYear before planStart → working = null, retirement = full
 *   (advisor's retirement was before the plan started, so the whole plan is retirement)
 */
export function computePresets(
  planStartYear: number,
  planEndYear: number,
  clientRetirementYear: number | null
): PresetWindows {
  const full: [number, number] = [planStartYear, planEndYear];

  if (clientRetirementYear === null) {
    return { full, working: null, retirement: null };
  }

  if (clientRetirementYear <= planStartYear) {
    // Retired at or before plan starts → entire plan is retirement
    return { full, working: null, retirement: full };
  }

  if (clientRetirementYear > planEndYear) {
    // Retires after plan ends → entire plan is working years
    return { full, working: full, retirement: null };
  }

  return {
    full,
    working: [planStartYear, clientRetirementYear - 1],
    retirement: [clientRetirementYear, planEndYear],
  };
}

/**
 * Check whether the current range exactly matches a given preset window.
 * Returns false when the preset is null (i.e., not available for this client).
 */
export function isPresetActive(
  current: [number, number],
  preset: [number, number] | null
): boolean {
  if (preset === null) return false;
  return current[0] === preset[0] && current[1] === preset[1];
}

/**
 * Clamp a range to [min, max] bounds. Swaps from/to if from > to (defensive,
 * since Radix can return values in either order during dragging edge cases).
 */
export function clampRange(
  range: [number, number],
  min: number,
  max: number
): [number, number] {
  let [from, to] = range;
  if (from > to) [from, to] = [to, from];
  from = Math.max(min, Math.min(max, from));
  to = Math.max(min, Math.min(max, to));
  return [from, to];
}

/**
 * Generate evenly-spaced year labels for the slider's axis.
 * Always includes min and max as the first and last labels.
 *
 * - For span >= targetCount: returns targetCount evenly-spaced ints
 * - For span < targetCount: returns every year between min and max inclusive (deduped)
 */
export function computeAxisLabels(
  min: number,
  max: number,
  targetCount: number = 8
): number[] {
  if (min === max) return [min];

  const span = max - min;
  if (span < targetCount) {
    const labels: number[] = [];
    for (let y = min; y <= max; y++) labels.push(y);
    return labels;
  }

  const labels: number[] = [];
  for (let i = 0; i < targetCount; i++) {
    const ratio = i / (targetCount - 1);
    labels.push(Math.round(min + ratio * span));
  }
  // Force exact endpoints (rounding might shift them by 1)
  labels[0] = min;
  labels[labels.length - 1] = max;
  return labels;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/components/cashflow/__tests__/year-range-utils.test.ts
```

Expected: All tests pass (~26 tests).

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: 208 existing + 26 new = 234 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/cashflow/year-range-utils.ts src/components/cashflow/__tests__/year-range-utils.test.ts
git commit -m "feat(slider): add year-range utility helpers"
```

---

## Task 3: `year-range-slider.tsx` — Radix slider + presets + axis labels

Pure presentational component. Owns no state of its own; props in, callbacks out.

**Files:**
- Create: `src/components/cashflow/year-range-slider.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/cashflow/year-range-slider.tsx`:

```tsx
"use client";

import * as Slider from "@radix-ui/react-slider";
import {
  computePresets,
  isPresetActive,
  clampRange,
  computeAxisLabels,
  type PresetWindows,
} from "./year-range-utils";

interface YearRangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  clientRetirementYear: number | null;
}

export function YearRangeSlider({
  min,
  max,
  value,
  onChange,
  clientRetirementYear,
}: YearRangeSliderProps) {
  const presets = computePresets(min, max, clientRetirementYear);
  const axisLabels = computeAxisLabels(min, max);
  const disabled = min === max;

  function applyPreset(preset: [number, number] | null) {
    if (preset === null) return;
    onChange(clampRange(preset, min, max));
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      {/* Preset buttons */}
      <div className="flex items-center gap-2">
        <PresetButton
          label="Full"
          active={isPresetActive(value, presets.full)}
          onClick={() => applyPreset(presets.full)}
        />
        <PresetButton
          label="Working Years"
          active={isPresetActive(value, presets.working)}
          disabled={presets.working === null}
          disabledReason="Set client DOB and retirement age to enable"
          onClick={() => applyPreset(presets.working)}
        />
        <PresetButton
          label="Retirement Years"
          active={isPresetActive(value, presets.retirement)}
          disabled={presets.retirement === null}
          disabledReason="Set client DOB and retirement age to enable"
          onClick={() => applyPreset(presets.retirement)}
        />
        <span className="ml-auto text-xs tabular-nums text-gray-400">
          {value[0]}{value[0] !== value[1] ? ` – ${value[1]}` : ""}
        </span>
      </div>

      {/* Slider */}
      <Slider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        value={value}
        min={min}
        max={max}
        step={1}
        minStepsBetweenThumbs={0}
        disabled={disabled}
        onValueChange={(next) => {
          if (next.length === 2) {
            onChange(clampRange([next[0], next[1]], min, max));
          }
        }}
        aria-label="Year range"
      >
        <Slider.Track className="relative h-1 w-full grow rounded-full bg-gray-700">
          <Slider.Range className="absolute h-full rounded-full bg-blue-500" />
        </Slider.Track>
        <Slider.Thumb
          className="block h-4 w-4 rounded-full border border-gray-300 bg-white shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          aria-label="From year"
        />
        <Slider.Thumb
          className="block h-4 w-4 rounded-full border border-gray-300 bg-white shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
          aria-label="To year"
        />
      </Slider.Root>

      {/* Year-label axis */}
      <div className="relative h-4 w-full">
        {axisLabels.map((label, i) => {
          const ratio = max === min ? 0 : (label - min) / (max - min);
          // Convert ratio (0..1) to a left percent; clamp endpoints to keep labels on-screen
          const leftPct = ratio * 100;
          // For the first and last labels, anchor to the side so they don't overflow
          const transform =
            i === 0
              ? "translateX(0)"
              : i === axisLabels.length - 1
                ? "translateX(-100%)"
                : "translateX(-50%)";
          return (
            <span
              key={label}
              className="absolute top-0 text-xs text-gray-500 tabular-nums"
              style={{ left: `${leftPct}%`, transform }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PresetButton({
  label,
  active,
  disabled = false,
  disabledReason,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
        disabled
          ? "cursor-not-allowed text-gray-600"
          : active
            ? "bg-gray-700 text-white"
            : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashflow/year-range-slider.tsx
git commit -m "feat(slider): add YearRangeSlider component (Radix + presets + axis)"
```

---

## Task 4: Wire `YearRangeSlider` into `cashflow-report.tsx`

Add range state, derive `visibleYears`, mount the slider, replace `years` with `visibleYears` in chart and table consumers.

**Files:**
- Modify: `src/components/cashflow-report.tsx`

- [ ] **Step 1: Read current file to find insertion points**

```bash
grep -n "useState\|useMemo\|setYears\|const years\|TaxDetailModal\|<Bar\|chartData\|table.*data" src/components/cashflow-report.tsx | head -25
```

Note the line where:
- The component declares state (top of `CashflowReport`)
- `setYears(projection)` lands the projection result
- The chart data is computed
- The table data is passed
- `<TaxDetailModal years={...} ... />` is rendered

- [ ] **Step 2: Add import for the new slider**

Near the top of `src/components/cashflow-report.tsx`, after the existing imports, add:

```typescript
import { YearRangeSlider } from "@/components/cashflow/year-range-slider";
```

- [ ] **Step 3: Compute the bounds and add range state**

Inside `CashflowReport`, after `clientData` is destructured/loaded but before any rendering logic (around the area where other useState/useMemo hooks live), add:

```typescript
const planStartYear =
  clientData?.planSettings.planStartYear ?? new Date().getFullYear();
const planEndYear =
  clientData?.planSettings.planEndYear ?? planStartYear + 50;

const clientRetirementYear = useMemo(() => {
  if (!clientData?.client.dateOfBirth || !clientData?.client.retirementAge) {
    return null;
  }
  return (
    parseInt(clientData.client.dateOfBirth.slice(0, 4), 10) +
    clientData.client.retirementAge
  );
}, [clientData]);

const [yearRange, setYearRange] = useState<[number, number]>([
  planStartYear,
  planEndYear,
]);

// Reset slider when plan boundaries change (e.g., advisor edits planEndYear in Assumptions)
useEffect(() => {
  setYearRange([planStartYear, planEndYear]);
}, [planStartYear, planEndYear]);

const visibleYears = useMemo(
  () => years.filter((y) => y.year >= yearRange[0] && y.year <= yearRange[1]),
  [years, yearRange]
);
```

NOTE: `useMemo`, `useState`, `useEffect` may already be imported. Verify with the existing imports at the top — if not, add to the React import statement.

- [ ] **Step 4: Mount the slider above the chart**

Find the page heading area (the JSX block that renders "Cash Flow Overview" or the equivalent title). Mount the slider just below the heading and above the chart:

```tsx
<YearRangeSlider
  min={planStartYear}
  max={planEndYear}
  value={yearRange}
  onChange={setYearRange}
  clientRetirementYear={clientRetirementYear}
/>
```

- [ ] **Step 5: Replace `years` with `visibleYears` everywhere it's consumed downstream**

Find every reference to `years` that feeds into:
- The chart data (look for `data: years.map`, `years.map(y =>`, etc.)
- The cashflow table (look for `data={years}` or `useReactTable({ data: years`)
- The Tax Detail modal mount (`<TaxDetailModal years={years} ... />`)
- Any drill-down summary aggregations that read from `years`

Replace each with `visibleYears`. Leave references that compute totals or look up specific years (e.g., for `accountBalances`) on `years` IF they need full-history context — but for the chart/table/modal rendering, switch to `visibleYears`.

If unsure about a specific reference, default to `visibleYears` for rendering and `years` for full-history lookups. The slider is a zoom on the rendered output, not a re-baseline on the math.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If `years` is no longer referenced after the substitution and TypeScript flags it as unused, that's OK — leave it if it's used by useMemo deps or aggregation, otherwise remove cleanly.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: 234 tests passing (208 existing + 26 from Task 2). No regressions.

- [ ] **Step 8: Commit**

```bash
git add src/components/cashflow-report.tsx
git commit -m "feat(slider): wire YearRangeSlider into cashflow report"
```

---

## Task 5: Manual smoke test + any polish

No code changes expected unless the smoke test reveals issues.

**Files:** (none unless bugs found)

- [ ] **Step 1: Start dev server**

```bash
cd /Users/danmueller/Desktop/foundry-planning-year-slider
[ -f .env.local ] || cp /Users/danmueller/Desktop/foundry-planning/.env.local .env.local
nohup npm run dev > /tmp/year-slider-dev.log 2>&1 &
disown
sleep 10
tail -10 /tmp/year-slider-dev.log
```

Expected: `Ready in <Xms>` line, server on http://localhost:3000.

- [ ] **Step 2: Slider appears with correct defaults**

1. Open a client with a 30-50 year projection (DOB and retirement age set)
2. Navigate to Cashflow Overview
3. Slider visible at top with three preset buttons + slider track + year labels
4. Default state: handles at planStart and planEnd; "Full" highlighted; year display shows full range
5. Year axis labels visible (~6-8) evenly spaced

- [ ] **Step 3: Drag interaction**

1. Drag the right handle leftward → chart and table truncate to show only the new range
2. Drag the left handle rightward → same, from the other side
3. After dragging, the "Full" preset button is no longer highlighted
4. Year display in the top-right reflects the new range

- [ ] **Step 4: Preset buttons**

1. Click "Working Years" → handles snap to the working-years window (planStart through retirement-1); button highlights
2. Click "Retirement Years" → handles snap to the retirement window; button highlights
3. Click "Full" → returns to full projection
4. Drag a handle while a preset is active → preset highlight clears

- [ ] **Step 5: Tax Detail modal inheritance**

1. Set the slider to 2050-2070 (or any partial window)
2. Click Expenses column header → Taxes column header → Tax Detail modal opens
3. Modal's tables show only rows in the selected window (not the full projection)
4. Close modal → return to filtered cashflow

- [ ] **Step 6: Plan-bounds change auto-reset**

1. Open Assumptions → Plan Horizon → bump planEndYear up by 5 years → Save
2. Navigate back to Cashflow Overview
3. Slider should be reset to the new full range (handles at new bounds, "Full" highlighted)

- [ ] **Step 7: No-DOB / no-retirement client**

1. Open a client where DOB or retirement age is missing
2. Cashflow Overview → slider renders, but Working Years and Retirement Years buttons are disabled
3. Hover the disabled buttons → tooltip "Set client DOB and retirement age to enable"

- [ ] **Step 8: Keyboard accessibility**

1. Tab to a slider handle (focus ring should be visible)
2. Arrow Left / Right moves the handle by 1 year
3. Shift + Arrow moves by 5 years (Radix default)
4. Tab moves to the next handle / preset button

- [ ] **Step 9: Edge cases**

1. **1-year projection**: open or temporarily configure a client with planStart === planEnd. Slider renders, handles overlap, drag is no-op, preset buttons collapse to "Full" only.
2. **Spouse-only retirement**: client has no retirement age but spouse does. Working/Retirement buttons stay disabled (uses clientRetirementYear only — by design).

- [ ] **Step 10: Run full test suite one more time**

```bash
npm test
```

Expected: 234 tests passing.

- [ ] **Step 11: Stop dev server, commit any polish**

```bash
pgrep -f "next dev" | xargs -r kill 2>/dev/null
```

If smoke test surfaced polish (spacing, color tweaks, copy edits), apply them and commit:

```bash
git add <changed files>
git commit -m "polish(slider): <describe the tweak>"
```

If no issues, no commit needed for this task.

---

## Done

The year-range slider is wired end-to-end:
- Lives at the top of the Cashflow Overview page
- Three preset buttons (Full / Working Years / Retirement Years) plus a draggable Radix dual-handle slider
- Filters the chart, the cashflow table (and all its drill-downs), and the Tax Detail modal
- Resets when plan boundaries change
- Disabled presets when client lacks DOB/retirement age
- 26 new helper tests, manual smoke covers the rest

**Followups already in FUTURE_WORK.md (no action needed):**
- Persist range across navigation (URL param / localStorage / DB) — deferred per session-state-only decision
- Apply slider to balance sheet, income/expenses pages — those don't yet render projection-driven multi-year data
- Marker overlays on the slider track (retirement year, AMT year) — visual decoration; defer until requested
