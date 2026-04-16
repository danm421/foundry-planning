# Year-Range Slider — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**FUTURE_WORK item:** "Year-range slider on plan pages" _(P6 E6 L2)_

## Overview

Add a dual-handle year-range slider to the top of the Cashflow Overview page. Filters the bar chart, the cashflow data table (and all its drill-downs), and the multi-year Tax Detail modal to show only the selected year window. State is session-only — resets on page reload or navigation away. Affects the Cashflow page only; client-data pages are untouched.

Includes two preset buttons besides "Full" — **Working Years** (`planStartYear` → `clientRetirementYear - 1`) and **Retirement Years** (`clientRetirementYear` → `planEndYear`) — for one-click jumps to common windows.

## User-Facing Flow

1. Advisor opens the Cashflow Overview page
2. Slider renders at the top, defaulting to the full projection
3. Three preset buttons sit above the slider track: `[Full]  [Working Years]  [Retirement Years]`
4. Drag either handle → chart and table filter to the selected window
5. Click a preset → slider snaps to that window, button highlights
6. Manual drag deactivates all preset highlights (advisor is in a custom range)
7. Open Tax Detail modal → modal shows only the rows in the visible window. First-year regime indicators still detect transitions on full history (so a 2034 AMT trigger isn't shown if the window is 2050-2075, but if AMT first appears within the visible window, it is shown)
8. Reset by clicking "Full"

State doesn't persist — refresh, navigate away, or change a plan setting that updates `planEndYear` and the slider returns to full.

## Architecture

```
src/components/cashflow/
  year-range-slider.tsx              CREATE — Radix-based dual-handle slider + preset buttons (~120 lines)
  year-range-utils.ts                CREATE — pure helpers: computePresets, isPresetActive, clampRange, computeAxisLabels (~80 lines)
  __tests__/
    year-range-utils.test.ts         CREATE — vitest suite for the four helpers (~150 lines)

src/components/cashflow-report.tsx   MODIFY (~20 lines)
  - Compute planStartYear, planEndYear, clientRetirementYear from clientData
  - Add useState for range, useEffect to reset when planStart/End change
  - Mount <YearRangeSlider> at the top of the page
  - Replace `years` with `visibleYears` (filtered) in chart data, table data, and TaxDetailModal mount

package.json                          MODIFY (+1 dep: @radix-ui/react-slider)
```

**Why split files:** the slider has two distinct concerns — Radix-based UI and pure helpers (preset computation, range clamping, axis labels). Splitting lets the helpers be unit-tested without React, mirroring the pattern we used for `tax-regime-indicators.ts` in the drill-down feature.

## Components

### `YearRangeSlider`

```typescript
interface YearRangeSliderProps {
  min: number;                         // planStartYear
  max: number;                         // planEndYear
  value: [number, number];             // [from, to]
  onChange: (next: [number, number]) => void;
  clientRetirementYear: number | null; // null disables the working/retirement presets
}
```

**Three rows** stacked:

1. **Preset buttons** — left-aligned, ~28px tall. Active preset gets `bg-gray-700 text-white`; inactive gets `text-gray-400 hover:text-gray-200`. "Working Years" and "Retirement Years" disabled with tooltip when `clientRetirementYear === null`.
2. **Radix slider** — thin track (2px), blue (`bg-blue-500`) fill between handles, circular handles ~14px. Min/max from props, step=1. While dragging, a small badge near the handle shows the current year value.
3. **Year-label axis** — 6-8 evenly-spaced year labels below the track. First label = `min`, last = `max`, evenly distributed in between via `computeAxisLabels`.

Total height ~80px.

**Interactions:**
- Drag handle → calls `onChange([newFrom, newTo])` with clamped values
- Click preset → calls `onChange` with that preset's bounds
- Keyboard: arrow keys move focused handle by 1 year; Shift+arrow by 5 years (Radix defaults)
- Touch: works out of the box (Radix)

### `year-range-utils.ts`

Pure functions, no React, no imports from anything outside `src/lib` or `src/engine` types.

```typescript
export interface PresetWindows {
  full: [number, number];
  working: [number, number] | null;     // null when clientRetirementYear isn't usable
  retirement: [number, number] | null;
}

export function computePresets(
  planStartYear: number,
  planEndYear: number,
  clientRetirementYear: number | null
): PresetWindows;

export function isPresetActive(
  current: [number, number],
  preset: [number, number] | null
): boolean;

export function clampRange(
  range: [number, number],
  min: number,
  max: number
): [number, number];

export function computeAxisLabels(
  min: number,
  max: number,
  targetCount?: number   // default 8
): number[];
```

**Preset rules:**
- `full` = `[planStartYear, planEndYear]` always
- `working` = `[planStartYear, clientRetirementYear - 1]` when `clientRetirementYear > planStartYear`; otherwise `null`
- `retirement` = `[clientRetirementYear, planEndYear]` when `clientRetirementYear <= planEndYear`; otherwise `null`

**Edge cases:**
- `clientRetirementYear === null` → both `working` and `retirement` are `null`
- `clientRetirementYear === planStartYear` → no working years (`null`), retirement = full
- `clientRetirementYear > planEndYear` → working = full, retirement = `null`

**`computeAxisLabels` rule:** for a span of N years and target T labels, produce roughly `T` evenly-spaced ints from `min` to `max` inclusive. Always include `min` and `max`. Dedup if span < T.

## Integration in `cashflow-report.tsx`

Three logical changes:

```typescript
// 1. Derive boundaries from clientData
const planStartYear = clientData?.planSettings.planStartYear ?? new Date().getFullYear();
const planEndYear   = clientData?.planSettings.planEndYear   ?? planStartYear + 50;
const clientRetirementYear = useMemo(() => {
  if (!clientData?.client.dateOfBirth || !clientData?.client.retirementAge) return null;
  return parseInt(clientData.client.dateOfBirth.slice(0, 4), 10) + clientData.client.retirementAge;
}, [clientData]);

// 2. Range state, with auto-reset when bounds change
const [range, setRange] = useState<[number, number]>([planStartYear, planEndYear]);
useEffect(() => {
  setRange([planStartYear, planEndYear]);
}, [planStartYear, planEndYear]);

// 3. Filtered years derived from range
const visibleYears = useMemo(
  () => years.filter((y) => y.year >= range[0] && y.year <= range[1]),
  [years, range]
);
```

**Mount the slider** above the existing chart, below the page heading.

**Replace `years` with `visibleYears`** in:
- Chart.js bar chart data (the `data: years.map(...)` lines)
- Cashflow data table (`<TanStackTable data={visibleYears} ... />`)
- Tax Detail modal mount (`<TaxDetailModal years={visibleYears} ... />`)
- Any drill-down summary aggregations that read from `years`

**Keep `years` (full projection)** in scope only for the slider bounds calc (which uses `planStartYear`/`planEndYear` from settings, not from `years`, so this doesn't actually need `years` at all — but other downstream code might).

## Tax Drill-Down Behavior

The `TaxDetailModal` already accepts `years: ProjectionYear[]` as a prop. By passing `visibleYears` instead of `years`, the modal naturally shows only the windowed rows. **No changes needed inside the modal.**

**Regime indicators** are computed inside `tax-regime-indicators.ts` from the array passed in. That means transitions are detected *within the visible window*. This creates a small inconsistency: if AMT first triggered in 2034 and the window is 2050+, the modal won't show "first AMT year" anywhere.

**Decision:** accept this behavior for v1. The slider is a zoom — advisors who want to see "first AMT year" should set the slider to "Full". A v2 enhancement could compute transitions on the full history and pass them in as a separate prop, but that adds plumbing for a marginal UX gain.

## Edge Cases

- **Plan settings change while slider is set** — `planStartYear` or `planEndYear` updates trigger `useEffect` that resets the slider to full. Otherwise advisor would be left looking at a window outside the new plan boundaries.
- **No retirement year on client** — Working Years and Retirement Years preset buttons are disabled with tooltip "Set client DOB and retirement age to enable"
- **Range collapses to one year** — slider lets handles meet (start === end). Chart shows one bar, table shows one row. No errors.
- **1-year projection** (planStart === planEnd) — slider has min === max; both handles at the same point. Disable drag (no-op).

## Testing Strategy

### Unit tests — `year-range-utils.test.ts`

**`computePresets`** (~10 tests):
- Returns full = [start, end] always
- With retirement year mid-projection → working/retirement split correctly at retirement
- With retirement year before plan start → working = null, retirement = full
- With retirement year after plan end → working = full, retirement = null
- With null retirement year → both working and retirement are null
- Working window is [start, retire-1] (exclusive of retirement year)
- Retirement window is [retire, end] (inclusive of retirement year)

**`isPresetActive`** (~4 tests):
- Returns true on exact match
- Returns false on partial overlap
- Returns false when preset is null
- Order-independent (or strict order — pick one and document)

**`clampRange`** (~6 tests):
- Returns range unchanged when in bounds
- Clamps `from` up to min when below
- Clamps `to` down to max when above
- Swaps when from > to (defensive)
- Both at same value (collapsed range) preserved
- Both equal to min returns [min, min]

**`computeAxisLabels`** (~6 tests):
- 50-year span returns 8 labels
- 5-year span returns 5 labels (no duplicates)
- 1-year span returns [min]
- First label always = min, last always = max
- Labels are integers, monotonically increasing
- Custom targetCount honored

Total ~26 tests.

### No React component tests

The repo has no React Testing Library setup. The slider component is validated by manual smoke test below. (RTL setup is its own backlog item.)

### Manual smoke test (mandatory before merge)

1. Start dev server, open a client with a 30-50 year projection
2. Cashflow Overview page — slider visible at top with three preset buttons + slider track + year labels
3. Default state: handles at planStart and planEnd; "Full" highlighted
4. Drag right handle to mid-projection → chart truncates, table truncates, "Full" deactivates
5. Click "Working Years" → handles snap, button highlights, chart shows pre-retirement only
6. Click "Retirement Years" → handles snap to retirement window
7. Click "Full" → returns to full projection
8. Open Tax Detail modal while range is set to 2050-2070 → modal shows only those rows
9. Edit `planEndYear` in Assumptions → return to cashflow → slider should be reset to full new range
10. Open a client with no DOB → Working Years and Retirement Years buttons are disabled with tooltip
11. Keyboard: tab to a handle, arrow keys move 1 year, Shift+arrow moves 5 years
12. Run `npm test` — 208 existing + ~26 new helper tests passing

### Edge cases to manually verify

- 1-year projection (planStart == planEnd) — slider renders without crashing, no drag possible
- Spouse-only retirement (client has no retirement age but spouse does) — Working/Retirement buttons disabled (uses clientRetirementYear only)
- Drag a handle past the other → handles swap (Radix default)

## Out of Scope / Future Work

- **Persist range across navigation** (URL query param, localStorage, or DB) — deferred per session-state-only decision
- **Apply slider to balance sheet, income/expenses, assumptions pages** — currently those pages don't render projection-driven multi-year data; revisit when they do
- **Transitions on full history when window is partial** — discussed in Tax Drill-Down section; deferred
- **Span-aware presets** ("Next 10", "Last 20") — could add later if advisors request
- **Marker overlays on the slider track** (retirement year, AMT year, etc.) — visual decoration; defer until requested
