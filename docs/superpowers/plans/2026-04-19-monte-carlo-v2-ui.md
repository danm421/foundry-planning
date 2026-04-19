# Monte Carlo v2 — Report UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Monte Carlo report UI into a client-facing artifact — hero gauge, fan chart with deterministic overlay, right-rail insights, and a terminal-value histogram — following the spec at `docs/superpowers/specs/2026-04-19-monte-carlo-v2-ui-design.md`.

**Architecture:** New subcomponents live under `src/components/monte-carlo/` with pure data-transform helpers in `src/components/monte-carlo/lib/`. The orchestrator `src/components/monte-carlo-report.tsx` keeps all state (fetch, engine run, seed, cross-client reset, auto-run) — only its render body is rebuilt. Charts use chart.js (already registered in the project). All new styling uses the Timeline jewel-accent system (emerald/slate/rose on `bg-slate-900/60 ring-1 ring-slate-800` cards).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, chart.js + react-chartjs-2, Vitest for tests.

---

## File Map

```
src/components/monte-carlo-report.tsx      # [modify] — orchestrator kept; body rebuilt
src/components/monte-carlo/
  report-header.tsx                         # [create] — title, subtitle, disabled "View Scenario"
  kpi-band.tsx                              # [create] — 5-card row
  kpi-card.tsx                              # [create] — generic card shell
  success-gauge.tsx                         # [create] — radial SVG arc
  fan-chart.tsx                             # [create] — chart.js fan chart + overlay
  terminal-histogram.tsx                    # [create] — chart.js ending-value distribution
  yearly-breakdown.tsx                      # [create] — restyled v1 spread table
  findings-card.tsx                         # [create] — right rail: failure % + median delta
  top-risks-card.tsx                        # [create] — right rail: static-heuristic risks
  recommendations-card.tsx                  # [create] — right rail: empty advisor slot
  lib/
    format.ts                               # [create] — short-currency, percent, integer formatters
    fan-chart-series.ts                     # [create] — byYear + deterministic → chart.js datasets
    terminal-histogram-series.ts            # [create] — ending-values → binned histogram
    top-risks.ts                            # [create] — summary + clientData + planSettings → risks[]
  __tests__/
    format.test.ts                          # [create]
    fan-chart-series.test.ts                # [create]
    terminal-histogram-series.test.ts       # [create]
    top-risks.test.ts                       # [create]
    success-gauge.test.tsx                  # [create] — dasharray proportion assertions

docs/FUTURE_WORK.md                         # [modify] — append deferred items
```

**Files touched outside this tree:**
- `docs/FUTURE_WORK.md` — append bullets for deferred work.
- `src/components/monte-carlo-report.tsx` — rewrite the JSX body only; keep all `useState` / `useEffect` / `useCallback` logic verbatim.

**Nothing under `src/engine/**` or `src/app/api/**` changes.** The existing 659 engine tests must stay green.

---

## Phase 0 — Foundation (pure helpers, TDD)

### Task 1: Short-currency + percent formatters

**Files:**
- Create: `src/components/monte-carlo/lib/format.ts`
- Test: `src/components/monte-carlo/__tests__/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/monte-carlo/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatShortCurrency, formatPercent, formatInteger } from "../lib/format";

describe("formatShortCurrency", () => {
  it("formats millions with one decimal", () => {
    expect(formatShortCurrency(2_400_000)).toBe("$2.4M");
    expect(formatShortCurrency(3_000_000)).toBe("$3.0M");
    expect(formatShortCurrency(950_000_000)).toBe("$950.0M");
  });
  it("formats thousands with no decimal", () => {
    expect(formatShortCurrency(95_000)).toBe("$95K");
    expect(formatShortCurrency(800_000)).toBe("$800K");
  });
  it("formats under a thousand with no decimal", () => {
    expect(formatShortCurrency(500)).toBe("$500");
    expect(formatShortCurrency(0)).toBe("$0");
  });
  it("handles negatives with a leading minus", () => {
    expect(formatShortCurrency(-2_400_000)).toBe("−$2.4M");
    expect(formatShortCurrency(-95_000)).toBe("−$95K");
  });
});

describe("formatPercent", () => {
  it("formats a 0–1 fraction as an integer percent", () => {
    expect(formatPercent(0.88)).toBe("88%");
    expect(formatPercent(0.125)).toBe("13%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("formatInteger", () => {
  it("comma-groups thousands", () => {
    expect(formatInteger(1000)).toBe("1,000");
    expect(formatInteger(5000)).toBe("5,000");
    expect(formatInteger(999)).toBe("999");
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/components/monte-carlo/__tests__/format.test.ts`
Expected: FAIL — "Cannot find module '../lib/format'"

- [ ] **Step 3: Implement the module**

Create `src/components/monte-carlo/lib/format.ts`:

```ts
// Minus sign U+2212 (not ASCII hyphen) — renders cleanly in tabular-nums
// and aligns with accounting-minus conventions already used elsewhere in
// the dark theme.
const MINUS = "\u2212";

export function formatShortCurrency(value: number): string {
  const sign = value < 0 ? MINUS : "";
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${sign}$${Math.round(n / 1_000)}K`;
  return `${sign}$${Math.round(n)}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function formatInteger(n: number): string {
  return n.toLocaleString("en-US");
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- src/components/monte-carlo/__tests__/format.test.ts`
Expected: PASS (3 suites, 8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/monte-carlo/lib/format.ts src/components/monte-carlo/__tests__/format.test.ts
git commit -m "feat(monte-carlo): short-currency + percent + integer formatters"
```

---

### Task 2: Top-risks pure helper

**Files:**
- Create: `src/components/monte-carlo/lib/top-risks.ts`
- Test: `src/components/monte-carlo/__tests__/top-risks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/monte-carlo/__tests__/top-risks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeTopRisks } from "../lib/top-risks";
import type { MonteCarloSummary } from "@/engine";

function summaryWithYearTen(p5AtYearTen: number, startMedian: number): MonteCarloSummary {
  const byYear = Array.from({ length: 20 }, (_, i) => ({
    year: 2026 + i,
    age: { client: 60 + i },
    balance: {
      p5: i === 10 ? p5AtYearTen : 1_000_000,
      p20: 1_200_000,
      p50: i === 0 ? startMedian : 1_500_000,
      p80: 2_000_000,
      p95: 2_500_000,
      min: 0,
      max: 3_000_000,
    },
    cagrFromStart: null,
  }));
  return {
    requestedTrials: 1000,
    trialsRun: 1000,
    aborted: false,
    successRate: 0.88,
    failureRate: 0.12,
    ending: { p5: 100, p20: 500, p50: 1000, p80: 2000, p95: 3000, min: 0, max: 4000, mean: 1500 },
    byYear,
  };
}

describe("computeTopRisks", () => {
  it("flags High Inflation when plan inflation > 3.5%", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(1_000_000, 2_000_000),
      { client: { planEndAge: 90 } },
      { inflationRate: 0.04 },
    );
    expect(risks.map((r) => r.label)).toContain("High Inflation");
  });

  it("flags Early Bear Market when year-10 p5 < starting median", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(500_000, 2_000_000),
      { client: { planEndAge: 90 } },
      { inflationRate: 0.025 },
    );
    expect(risks.map((r) => r.label)).toContain("Early Bear Market");
  });

  it("flags Longevity when planEndAge > 95", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(1_000_000, 2_000_000),
      { client: { planEndAge: 100 } },
      { inflationRate: 0.025 },
    );
    expect(risks.map((r) => r.label)).toContain("Longevity");
  });

  it("returns an empty array when no heuristic fires", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(1_000_000, 500_000), // year-10 p5 > starting median
      { client: { planEndAge: 90 } },
      { inflationRate: 0.025 },
    );
    expect(risks).toEqual([]);
  });

  it("returns all three when all fire, in stable order", () => {
    const risks = computeTopRisks(
      summaryWithYearTen(500_000, 2_000_000),
      { client: { planEndAge: 100 } },
      { inflationRate: 0.04 },
    );
    expect(risks.map((r) => r.label)).toEqual(["High Inflation", "Early Bear Market", "Longevity"]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/components/monte-carlo/__tests__/top-risks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/monte-carlo/lib/top-risks.ts`:

```ts
import type { MonteCarloSummary } from "@/engine";

export type RiskTone = "emerald" | "amber" | "rose";

export interface TopRisk {
  label: string;
  tone: RiskTone;
}

interface ClientLike {
  client: {
    planEndAge: number;
  };
}

interface PlanSettingsLike {
  inflationRate: number;
}

export function computeTopRisks(
  summary: MonteCarloSummary,
  clientData: ClientLike,
  planSettings: PlanSettingsLike,
): TopRisk[] {
  const risks: TopRisk[] = [];

  if (planSettings.inflationRate > 0.035) {
    risks.push({ label: "High Inflation", tone: "amber" });
  }

  // "Early Bear Market" — at ~10 years in, the 5th-percentile balance is
  // below the plan's starting median. Clamp the lookup to the last byYear
  // entry for short plans.
  const n = summary.byYear.length;
  if (n > 0) {
    const yearTenIdx = Math.min(10, n - 1);
    const startMedian = summary.byYear[0].balance.p50;
    const yearTenP5 = summary.byYear[yearTenIdx].balance.p5;
    if (yearTenP5 < startMedian) {
      risks.push({ label: "Early Bear Market", tone: "rose" });
    }
  }

  if (clientData.client.planEndAge > 95) {
    risks.push({ label: "Longevity", tone: "amber" });
  }

  return risks;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- src/components/monte-carlo/__tests__/top-risks.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/monte-carlo/lib/top-risks.ts src/components/monte-carlo/__tests__/top-risks.test.ts
git commit -m "feat(monte-carlo): top-risks pure helper with three static heuristics"
```

---

### Task 3: Fan-chart series builder

**Files:**
- Create: `src/components/monte-carlo/lib/fan-chart-series.ts`
- Test: `src/components/monte-carlo/__tests__/fan-chart-series.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/monte-carlo/__tests__/fan-chart-series.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFanChartSeries } from "../lib/fan-chart-series";
import type { MonteCarloSummary } from "@/engine";

function mkByYear(years: number): MonteCarloSummary["byYear"] {
  return Array.from({ length: years }, (_, i) => ({
    year: 2026 + i,
    age: { client: 60 + i },
    balance: {
      p5: 100 + i,
      p20: 200 + i,
      p50: 300 + i,
      p80: 400 + i,
      p95: 500 + i,
      min: 50 + i,
      max: 600 + i,
    },
    cagrFromStart: null,
  }));
}

describe("buildFanChartSeries", () => {
  it("returns six datasets in the order chart.js fill:'-1' expects when deterministic is provided", () => {
    const byYear = mkByYear(5);
    const deterministic = [350, 360, 370, 380, 390];
    const { datasets, ages } = buildFanChartSeries(byYear, deterministic);

    expect(ages).toEqual([60, 61, 62, 63, 64]);
    expect(datasets).toHaveLength(6);
    expect(datasets[0].label).toBe("p5-baseline");
    expect(datasets[1].label).toBe("Lower Bounds");
    expect(datasets[2].label).toBe("p20-baseline");
    expect(datasets[3].label).toBe("Higher Outcomes");
    expect(datasets[4].label).toBe("Median");
    expect(datasets[5].label).toBe("Cash Flow Projection");
  });

  it("wires fill:'-1' on band datasets so they stack off their baselines", () => {
    const { datasets } = buildFanChartSeries(mkByYear(3), [0, 0, 0]);
    expect(datasets[1].fill).toBe("-1"); // p95 fills down to p5 baseline
    expect(datasets[3].fill).toBe("-1"); // p80 fills down to p20 baseline
    expect(datasets[0].fill).toBe(false);
    expect(datasets[2].fill).toBe(false);
    expect(datasets[4].fill).toBe(false);
    expect(datasets[5].fill).toBe(false);
  });

  it("copies percentile values correctly into the right datasets", () => {
    const byYear = mkByYear(3);
    const { datasets } = buildFanChartSeries(byYear, [999, 999, 999]);
    expect(datasets[0].data).toEqual([100, 101, 102]); // p5
    expect(datasets[1].data).toEqual([500, 501, 502]); // p95
    expect(datasets[2].data).toEqual([200, 201, 202]); // p20
    expect(datasets[3].data).toEqual([400, 401, 402]); // p80
    expect(datasets[4].data).toEqual([300, 301, 302]); // p50
    expect(datasets[5].data).toEqual([999, 999, 999]); // deterministic
  });

  it("omits the deterministic overlay dataset when deterministic is undefined", () => {
    const { datasets } = buildFanChartSeries(mkByYear(3), undefined);
    expect(datasets).toHaveLength(5);
    expect(datasets.find((d) => d.label === "Cash Flow Projection")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/components/monte-carlo/__tests__/fan-chart-series.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/monte-carlo/lib/fan-chart-series.ts`:

```ts
import type { MonteCarloSummary } from "@/engine";

export interface FanChartDataset {
  label: string;
  data: number[];
  borderColor?: string;
  backgroundColor?: string;
  borderWidth?: number;
  borderDash?: number[];
  pointRadius?: number;
  fill: false | "-1";
  tension?: number;
  order?: number;
}

export interface FanChartSeries {
  ages: number[];
  datasets: FanChartDataset[];
}

const COLOR_OUTER_BAND = "rgba(148, 163, 184, 0.18)"; // slate-400 @ 18%
const COLOR_INNER_BAND = "rgba(52, 211, 153, 0.35)";  // emerald-400 @ 35%
const COLOR_MEDIAN = "rgb(110, 231, 183)";            // emerald-300
const COLOR_DETERMINISTIC = "rgb(148, 163, 184)";     // slate-400

export function buildFanChartSeries(
  byYear: MonteCarloSummary["byYear"],
  deterministic: number[] | undefined,
): FanChartSeries {
  const ages = byYear.map((y) => y.age.client);

  const datasets: FanChartDataset[] = [
    {
      label: "p5-baseline",
      data: byYear.map((y) => y.balance.p5),
      borderColor: "transparent",
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 6,
    },
    {
      label: "Lower Bounds",
      data: byYear.map((y) => y.balance.p95),
      borderColor: "transparent",
      backgroundColor: COLOR_OUTER_BAND,
      pointRadius: 0,
      fill: "-1",
      tension: 0.25,
      order: 5,
    },
    {
      label: "p20-baseline",
      data: byYear.map((y) => y.balance.p20),
      borderColor: "transparent",
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 4,
    },
    {
      label: "Higher Outcomes",
      data: byYear.map((y) => y.balance.p80),
      borderColor: "transparent",
      backgroundColor: COLOR_INNER_BAND,
      pointRadius: 0,
      fill: "-1",
      tension: 0.25,
      order: 3,
    },
    {
      label: "Median",
      data: byYear.map((y) => y.balance.p50),
      borderColor: COLOR_MEDIAN,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 1,
    },
  ];

  if (deterministic && deterministic.length === byYear.length) {
    datasets.push({
      label: "Cash Flow Projection",
      data: deterministic,
      borderColor: COLOR_DETERMINISTIC,
      borderWidth: 2,
      borderDash: [6, 4],
      pointRadius: 0,
      fill: false,
      tension: 0.25,
      order: 2,
    });
  }

  return { ages, datasets };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- src/components/monte-carlo/__tests__/fan-chart-series.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/monte-carlo/lib/fan-chart-series.ts src/components/monte-carlo/__tests__/fan-chart-series.test.ts
git commit -m "feat(monte-carlo): fan-chart series builder (5 stacked datasets + deterministic overlay)"
```

---

### Task 4: Terminal-histogram series builder

**Files:**
- Create: `src/components/monte-carlo/lib/terminal-histogram-series.ts`
- Test: `src/components/monte-carlo/__tests__/terminal-histogram-series.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/monte-carlo/__tests__/terminal-histogram-series.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildHistogramSeries } from "../lib/terminal-histogram-series";

describe("buildHistogramSeries", () => {
  it("produces 20 bins by default", () => {
    const values = Array.from({ length: 1000 }, (_, i) => i);
    const series = buildHistogramSeries(values);
    expect(series.bins).toHaveLength(20);
  });

  it("covers min to max exactly", () => {
    const values = [100, 200, 300, 400, 500];
    const { bins } = buildHistogramSeries(values);
    expect(bins[0].min).toBeCloseTo(100, 5);
    expect(bins[bins.length - 1].max).toBeCloseTo(500, 5);
  });

  it("counts sum to N", () => {
    const values = Array.from({ length: 500 }, (_, i) => i * 2);
    const { bins } = buildHistogramSeries(values);
    const sum = bins.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(500);
  });

  it("exposes p5 / p50 / p95 of the input values", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const { p5, p50, p95 } = buildHistogramSeries(values);
    expect(p5).toBeCloseTo(5, 0);
    expect(p50).toBeCloseTo(50, 0);
    expect(p95).toBeCloseTo(95, 0);
  });

  it("handles degenerate input (all same value) without NaN", () => {
    const { bins, p50 } = buildHistogramSeries([1000, 1000, 1000]);
    expect(bins).toHaveLength(20);
    expect(p50).toBe(1000);
    const sum = bins.reduce((acc, b) => acc + b.count, 0);
    expect(sum).toBe(3);
  });

  it("handles empty input without throwing", () => {
    const { bins } = buildHistogramSeries([]);
    expect(bins).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/components/monte-carlo/__tests__/terminal-histogram-series.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/monte-carlo/lib/terminal-histogram-series.ts`:

```ts
export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

export interface HistogramSeries {
  bins: HistogramBin[];
  p5: number;
  p50: number;
  p95: number;
}

const BIN_COUNT = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

export function buildHistogramSeries(values: number[]): HistogramSeries {
  if (values.length === 0) {
    return { bins: [], p5: NaN, p50: NaN, p95: NaN };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min;

  // Degenerate case — all identical values collapse into a single spike.
  // Fabricate 20 zero-width bins centered on the value so the chart still
  // has something to render; put the full count in the middle bin.
  if (range === 0) {
    const bins: HistogramBin[] = Array.from({ length: BIN_COUNT }, () => ({
      min,
      max,
      count: 0,
    }));
    bins[Math.floor(BIN_COUNT / 2)].count = values.length;
    return { bins, p5: min, p50: min, p95: min };
  }

  const binWidth = range / BIN_COUNT;
  const bins: HistogramBin[] = Array.from({ length: BIN_COUNT }, (_, i) => ({
    min: min + i * binWidth,
    max: min + (i + 1) * binWidth,
    count: 0,
  }));

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= BIN_COUNT) idx = BIN_COUNT - 1; // clamp the max value into the last bin
    bins[idx].count += 1;
  }

  return {
    bins,
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- src/components/monte-carlo/__tests__/terminal-histogram-series.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/monte-carlo/lib/terminal-histogram-series.ts src/components/monte-carlo/__tests__/terminal-histogram-series.test.ts
git commit -m "feat(monte-carlo): terminal-histogram series builder with percentile markers"
```

---

## Phase 1 — KPI band (CHECKPOINT 1)

### Task 5: Generic KPI card shell

**Files:**
- Create: `src/components/monte-carlo/kpi-card.tsx`

- [ ] **Step 1: Create the file**

Create `src/components/monte-carlo/kpi-card.tsx`:

```tsx
import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  visual?: ReactNode;
  footnote?: ReactNode;
}

export function KpiCard({ label, value, visual, footnote }: KpiCardProps) {
  return (
    <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4 flex items-start justify-between gap-3 min-h-[96px]">
      <div className="flex flex-col gap-1">
        <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
        <div className="text-3xl font-semibold text-slate-100 tabular-nums leading-tight">
          {value}
        </div>
        {footnote ? (
          <div className="text-[11px] text-slate-500 mt-1">{footnote}</div>
        ) : null}
      </div>
      {visual ? <div className="shrink-0">{visual}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS — no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/kpi-card.tsx
git commit -m "feat(monte-carlo): generic KPI card shell"
```

---

### Task 6: Success gauge (radial SVG arc)

**Files:**
- Create: `src/components/monte-carlo/success-gauge.tsx`
- Test: `src/components/monte-carlo/__tests__/success-gauge.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/monte-carlo/__tests__/success-gauge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SuccessGauge } from "../success-gauge";

function getFillDasharray(container: HTMLElement): string {
  const fillArc = container.querySelector("[data-testid='gauge-fill']") as SVGPathElement;
  return fillArc.getAttribute("stroke-dasharray") ?? "";
}

function parseFillLength(dasharray: string): number {
  // dasharray is "<filled> <remaining>" — we care about the filled portion
  const [filled] = dasharray.trim().split(/\s+/);
  return parseFloat(filled);
}

describe("SuccessGauge", () => {
  it("renders 0% with zero fill", () => {
    const { container } = render(<SuccessGauge value={0} />);
    expect(parseFillLength(getFillDasharray(container))).toBeCloseTo(0, 1);
  });

  it("renders 100% with full-arc fill", () => {
    const { container } = render(<SuccessGauge value={1} />);
    const total = Math.PI * 70; // radius 70 × PI for a 180° arc
    expect(parseFillLength(getFillDasharray(container))).toBeCloseTo(total, 0);
  });

  it("renders 50% with half-arc fill", () => {
    const { container } = render(<SuccessGauge value={0.5} />);
    const total = Math.PI * 70;
    expect(parseFillLength(getFillDasharray(container))).toBeCloseTo(total / 2, 0);
  });

  it("renders the percentage label in the center", () => {
    const { container } = render(<SuccessGauge value={0.88} />);
    const label = container.querySelector("[data-testid='gauge-label']");
    expect(label?.textContent).toBe("88%");
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/components/monte-carlo/__tests__/success-gauge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/monte-carlo/success-gauge.tsx`:

```tsx
const RADIUS = 70;
const STROKE_WIDTH = 10;
const WIDTH = 2 * (RADIUS + STROKE_WIDTH);
const HEIGHT = RADIUS + STROKE_WIDTH * 2;
const CX = WIDTH / 2;
const CY = RADIUS + STROKE_WIDTH;
const ARC_LENGTH = Math.PI * RADIUS; // circumference of a half-circle

// SVG path for a 180° arc from (CX - RADIUS, CY) to (CX + RADIUS, CY).
// Using the A (elliptical arc) command: rx ry x-axis-rotation large-arc-flag sweep-flag x y
const ARC_PATH = `M ${CX - RADIUS} ${CY} A ${RADIUS} ${RADIUS} 0 0 1 ${CX + RADIUS} ${CY}`;

interface SuccessGaugeProps {
  value: number; // 0..1
}

export function SuccessGauge({ value }: SuccessGaugeProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = ARC_LENGTH * clamped;
  const remaining = ARC_LENGTH - filled;

  return (
    <div className="relative" style={{ width: WIDTH, height: HEIGHT }}>
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <defs>
          <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(251, 113, 133)" />   {/* rose-400 */}
            <stop offset="50%" stopColor="rgb(251, 191, 36)" />   {/* amber-400 */}
            <stop offset="100%" stopColor="rgb(52, 211, 153)" />  {/* emerald-400 */}
          </linearGradient>
        </defs>
        {/* Track */}
        <path
          d={ARC_PATH}
          fill="none"
          stroke="rgb(30, 41, 59)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        {/* Fill */}
        <path
          data-testid="gauge-fill"
          d={ARC_PATH}
          fill="none"
          stroke="url(#gauge-gradient)"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${remaining}`}
        />
      </svg>
      <div
        data-testid="gauge-label"
        className="absolute inset-x-0 flex justify-center text-2xl font-semibold text-slate-100 tabular-nums"
        style={{ top: CY - 16 }}
      >
        {Math.round(clamped * 100)}%
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm test -- src/components/monte-carlo/__tests__/success-gauge.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/monte-carlo/success-gauge.tsx src/components/monte-carlo/__tests__/success-gauge.test.tsx
git commit -m "feat(monte-carlo): success gauge — 180° SVG radial arc"
```

---

### Task 7: KPI band composition (5 cards)

**Files:**
- Create: `src/components/monte-carlo/kpi-band.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/monte-carlo/kpi-band.tsx`:

```tsx
import type { MonteCarloSummary, ClientData, PlanSettings } from "@/engine";
import { KpiCard } from "./kpi-card";
import { SuccessGauge } from "./success-gauge";
import { formatShortCurrency, formatInteger } from "./lib/format";

interface KpiBandProps {
  summary: MonteCarloSummary;
  clientData: ClientData;
  planSettings: PlanSettings;
}

function startAge(dateOfBirth: string, planStartYear: number): number {
  const birthYear = new Date(dateOfBirth).getFullYear();
  return planStartYear - birthYear;
}

function annualIncomeAtStart(clientData: ClientData, planStartYear: number): number {
  const incomes = (clientData.incomes ?? []) as Array<{
    annualAmount: number | string;
    startYear?: number | null;
    endYear?: number | null;
  }>;
  let total = 0;
  for (const inc of incomes) {
    const starts = inc.startYear ?? -Infinity;
    const ends = inc.endYear ?? Infinity;
    if (planStartYear >= starts && planStartYear <= ends) {
      const amt = typeof inc.annualAmount === "string" ? parseFloat(inc.annualAmount) : inc.annualAmount;
      if (Number.isFinite(amt)) total += amt;
    }
  }
  return total;
}

export function KpiBand({ summary, clientData, planSettings }: KpiBandProps) {
  const successPct = summary.successRate;
  const medianEnding = summary.ending.p50;
  const annualIncome = annualIncomeAtStart(clientData, planSettings.planStartYear);
  const startAgeVal = startAge(clientData.client.dateOfBirth, planSettings.planStartYear);
  const trialsRun = summary.trialsRun;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        label="Success Probability"
        value={<span className="sr-only">{Math.round(successPct * 100)}%</span>}
        visual={<SuccessGauge value={successPct} />}
      />
      <KpiCard
        label="Median Portfolio Value"
        value={formatShortCurrency(medianEnding)}
      />
      <KpiCard
        label="Annual Income"
        value={formatShortCurrency(annualIncome)}
      />
      <KpiCard
        label="Start Age"
        value={startAgeVal}
      />
      <KpiCard
        label="Simulations"
        value={formatInteger(trialsRun)}
        footnote={summary.aborted ? <span className="text-amber-300">⚠ partial run</span> : null}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS — no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/kpi-band.tsx
git commit -m "feat(monte-carlo): KPI band — 5 cards with success gauge"
```

---

### Task 8: Report header

**Files:**
- Create: `src/components/monte-carlo/report-header.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/monte-carlo/report-header.tsx`:

```tsx
interface ReportHeaderProps {
  clientDisplayName: string;
  onRestart: () => void;
  running: boolean;
}

export function ReportHeader({ clientDisplayName, onRestart, running }: ReportHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-100">
          Monte Carlo Simulation: Retirement Forecast
        </h1>
        <p className="text-sm text-slate-400">Client: {clientDisplayName}</p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onRestart}
          disabled={running}
          className="rounded border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-200 hover:border-emerald-400/60 hover:text-emerald-300 disabled:opacity-50"
          title="Re-run with a new random seed"
        >
          {running ? "Running…" : "New Seed"}
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="rounded bg-emerald-500/20 ring-1 ring-emerald-400/40 px-3 py-1.5 text-sm text-emerald-300 opacity-60 cursor-not-allowed"
        >
          View Scenario
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/report-header.tsx
git commit -m "feat(monte-carlo): report header — title, subtitle, new-seed + disabled View Scenario"
```

---

### Task 9: Wire header + KPI band into the orchestrator (CHECKPOINT 1)

**Files:**
- Modify: `src/components/monte-carlo-report.tsx`

- [ ] **Step 1: Read the current orchestrator to find the render block**

Read `src/components/monte-carlo-report.tsx`. The current file is 308 lines long. Key landmarks:

- State and effects: lines ~40–165. **Do not touch.**
- Early-return error/loading branches: lines 167–185.
- Main report body: starts with `<header>` at line 188. The 4 v1 KPI cards use a local `<Kpi>` helper around lines 235–252. The "Monte Carlo Asset Spread" table starts at line 253.

In this task we replace the `<header>` block (lines ~188–195) and the 4 KPI cards (~235–252). The table below stays for now; Task 18 retires it.

- [ ] **Step 2: Replace the header + KPI block with the new components**

Modify `src/components/monte-carlo-report.tsx`:

a) Add these imports near the other imports at the top of the file:

```tsx
import { ReportHeader } from "./monte-carlo/report-header";
import { KpiBand } from "./monte-carlo/kpi-band";
```

b) Replace the existing `<header>` block (the one containing the "Monte Carlo" title and the 4 old KPI cards) with:

```tsx
<ReportHeader
  clientDisplayName={
    clientData.client.spouseName
      ? `${clientData.client.firstName} & ${clientData.client.spouseName} ${clientData.client.lastName}`
      : `${clientData.client.firstName} ${clientData.client.lastName}`
  }
  onRestart={handleRestart}
  running={running}
/>
{summary ? (
  <KpiBand
    summary={summary}
    clientData={clientData}
    planSettings={clientData.planSettings}
  />
) : (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <div
        key={i}
        className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4 min-h-[96px] animate-pulse"
      />
    ))}
  </div>
)}
```

Keep every `useState` / `useEffect` / `useCallback` block untouched. Keep the existing "Running… (progress/total)" line and the warning banner about all-fixed-rate plans untouched for now — we'll retire them in Phase 5 when the loading skeletons land.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. The fields referenced (`firstName`, `lastName`, `spouseName?`, `dateOfBirth`, `retirementAge` on `ClientInfo`; `planStartYear`, `inflationRate` on `PlanSettings`; `incomes: Income[]` on `ClientData`) all exist in `src/engine/types.ts` (lines 6–48 for ClientData/ClientInfo; lines 222–234 for PlanSettings).

- [ ] **Step 4: Visual check (manual)**

Start the dev server (port 3001, per handoff): `npm run dev -- -p 3001`

Navigate to `/clients/<some-id>/monte-carlo` and verify:
- Header renders with "Monte Carlo Simulation: Retirement Forecast" + client name.
- 5 KPI cards render in a row; gauge shows the success probability.
- Loading skeletons appear before the summary is ready.
- "New Seed" triggers a re-run; gauge updates to new value.
- "View Scenario" is visibly disabled with a tooltip.

Stop the dev server when done.

- [ ] **Step 5: Commit (CHECKPOINT 1)**

```bash
git add src/components/monte-carlo-report.tsx
git commit -m "feat(monte-carlo): wire new header + KPI band into the report (v2 checkpoint 1)"
```

**Stop here and show the user. Don't advance to Phase 2 until they approve checkpoint 1.**

---

## Phase 2 — Fan chart (CHECKPOINT 2)

### Task 10: Fan chart component (data, chart.js config, annotations, overlay)

**Files:**
- Create: `src/components/monte-carlo/fan-chart.tsx`

- [ ] **Step 1: Read how cashflow-report registers chart.js and draws its custom plugin**

Run: `sed -n '1,140p' src/components/cashflow-report.tsx` (or use Read — the `timelineMarkersPlugin` starts around line 50, ChartJS.register at the top). Note the exact `ChartJS.register(...)` call and the `afterDatasetsDraw` plugin pattern.

- [ ] **Step 2: Create the fan chart**

Create `src/components/monte-carlo/fan-chart.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { MonteCarloSummary } from "@/engine";
import { buildFanChartSeries } from "./lib/fan-chart-series";
import { formatShortCurrency } from "./lib/format";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler);

interface TerminalCalloutOptions {
  p5: number;
  p50: number;
  p95: number;
}

// Renders p5 / p50 / p95 dollar labels just inside the right edge of the
// chart at the three terminal-age values. Visual parity with the mockup.
const terminalCalloutsPlugin = {
  id: "terminalCallouts",
  afterDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number; left: number; right: number };
      scales: { x: { getPixelForValue(v: number): number }; y: { getPixelForValue(v: number): number } };
      data: { labels: (string | number)[] };
    },
    _args: unknown,
    options: TerminalCalloutOptions,
  ) {
    if (!options) return;
    const { ctx, scales, data } = chart;
    const lastIdx = data.labels.length - 1;
    const x = scales.x.getPixelForValue(lastIdx);
    const entries: Array<{ y: number; label: string; color: string }> = [
      { y: scales.y.getPixelForValue(options.p95), label: formatShortCurrency(options.p95), color: "rgb(148, 163, 184)" },
      { y: scales.y.getPixelForValue(options.p50), label: formatShortCurrency(options.p50), color: "rgb(110, 231, 183)" },
      { y: scales.y.getPixelForValue(options.p5),  label: formatShortCurrency(options.p5),  color: "rgb(251, 113, 133)" },
    ];
    ctx.save();
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const e of entries) {
      ctx.fillStyle = e.color;
      ctx.fillText(e.label, x + 6, e.y);
    }
    ctx.restore();
  },
};

interface AgeMarker {
  age: number;
  label: string;
  color: string;
}

const ageMarkersPlugin = {
  id: "ageMarkers",
  afterDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number; left: number; right: number };
      scales: { x: { getPixelForValue(v: number): number } };
      data: { labels: (string | number)[] };
    },
    _args: unknown,
    options: { markers?: AgeMarker[] },
  ) {
    const markers = options?.markers ?? [];
    if (markers.length === 0) return;
    const { ctx, chartArea, scales, data } = chart;
    ctx.save();
    for (const m of markers) {
      const idx = (data.labels as number[]).indexOf(m.age);
      if (idx < 0) continue;
      const x = scales.x.getPixelForValue(idx);
      ctx.strokeStyle = m.color;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top + 8);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(x, chartArea.top + 6, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(m.label, x, chartArea.top - 2);
    }
    ctx.restore();
  },
};

ChartJS.register(terminalCalloutsPlugin, ageMarkersPlugin);

interface FanChartProps {
  summary: MonteCarloSummary;
  deterministic: number[] | undefined;
  ageMarkers: AgeMarker[];
}

export function FanChart({ summary, deterministic, ageMarkers }: FanChartProps) {
  const { ages, datasets } = useMemo(
    () => buildFanChartSeries(summary.byYear, deterministic),
    [summary.byYear, deterministic],
  );

  const ending = summary.byYear[summary.byYear.length - 1]?.balance;

  const data = {
    labels: ages,
    datasets,
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    layout: { padding: { right: 56, top: 16 } }, // room for terminal callouts
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.92)",
        titleColor: "rgb(226, 232, 240)",
        bodyColor: "rgb(203, 213, 225)",
        borderColor: "rgb(30, 41, 59)",
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items: Array<{ label: string }>) => `Age ${items[0]?.label ?? ""}`,
          label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) => {
            const name = ctx.dataset.label ?? "";
            if (name === "p5-baseline" || name === "p20-baseline") return null;
            return `${name}: ${formatShortCurrency(ctx.parsed.y)}`;
          },
        },
      },
      terminalCallouts: ending
        ? { p5: ending.p5, p50: ending.p50, p95: ending.p95 }
        : undefined,
      ageMarkers: { markers: ageMarkers },
    },
    scales: {
      x: {
        title: { display: true, text: "Age", color: "rgb(148, 163, 184)" },
        grid: { color: "rgba(30, 41, 59, 0.6)" },
        ticks: { color: "rgb(148, 163, 184)" },
      },
      y: {
        title: { display: true, text: "Portfolio Value", color: "rgb(148, 163, 184)" },
        grid: { color: "rgba(30, 41, 59, 0.6)" },
        ticks: {
          color: "rgb(148, 163, 184)",
          callback: (v: number | string) => formatShortCurrency(typeof v === "string" ? parseFloat(v) : v),
        },
      },
    },
  };

  return (
    <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-100">Retirement Success Probability</h2>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-400/60" /> Lower Bounds
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400/70" /> Higher Outcomes
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 bg-emerald-300" /> Median
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-4 bg-slate-400" style={{ borderTop: "2px dashed" }} /> Cash Flow
          </span>
        </div>
      </div>
      <div className="relative h-[400px]">
        {/* Static "Current Projection / 90% Confidence Interval" pill — positioned over the middle of the chart */}
        <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 rounded-md bg-slate-950/80 ring-1 ring-slate-700 px-3 py-1.5 text-center">
          <div className="text-[11px] font-semibold text-slate-100">Current Projection</div>
          <div className="text-[10px] text-slate-400">90% Confidence Interval</div>
        </div>
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If chart.js types complain about the custom plugin-options shape, relax to `Record<string, unknown>` on the plugin-options param — do NOT cast via `as any`.

- [ ] **Step 4: Commit**

```bash
git add src/components/monte-carlo/fan-chart.tsx
git commit -m "feat(monte-carlo): fan chart with deterministic overlay, age markers, terminal callouts"
```

---

### Task 11: Wire fan chart into the orchestrator (CHECKPOINT 2)

**Files:**
- Modify: `src/components/monte-carlo-report.tsx`

- [ ] **Step 1: Add imports and compute the deterministic series**

At the top of `src/components/monte-carlo-report.tsx`, add:

```tsx
import { FanChart } from "./monte-carlo/fan-chart";
import { runProjection, liquidPortfolioTotal } from "@/engine";
```

`liquidPortfolioTotal(year)` is the canonical engine helper (exported from `src/engine/index.ts:38`) that returns `portfolioAssets.taxableTotal + cashTotal + retirementTotal` — exactly the same liquid-asset definition the MC engine uses inside each trial. Using it for the overlay guarantees apples-to-apples comparison with the fan-chart bands.

Inside the component body, compute the deterministic series once per clientData:

```tsx
const deterministic = useMemo(() => {
  if (!clientData) return undefined;
  try {
    // runProjection returns ProjectionYear[] directly (not an object with a
    // `years` property) — see src/engine/projection.ts:114.
    const years = runProjection(clientData);
    return years.map(liquidPortfolioTotal);
  } catch {
    return undefined;
  }
}, [clientData]);
```

Compute the age markers from `clientData.client` (spouse fields live flat on `ClientInfo`, not on a separate `spouse` object — see types.ts line 36 onward):

```tsx
const ageMarkers = useMemo(() => {
  if (!clientData) return [];
  const c = clientData.client;
  const markers: Array<{ age: number; label: string; color: string }> = [
    { age: c.retirementAge, label: `Retire ${c.retirementAge}`, color: "rgb(110, 231, 183)" },
  ];
  if (c.spouseRetirementAge != null && c.spouseRetirementAge !== c.retirementAge) {
    markers.push({
      age: c.spouseRetirementAge,
      label: `Spouse ${c.spouseRetirementAge}`,
      color: "rgb(125, 211, 252)", // sky-300 — Timeline's "life" color
    });
  }
  return markers;
}, [clientData]);
```

- [ ] **Step 2: Insert the fan chart below the KPI band, above the existing v1 spread table**

Add this JSX in the report body right after the KPI band block:

```tsx
{summary ? (
  <FanChart
    summary={summary}
    deterministic={deterministic}
    ageMarkers={ageMarkers}
  />
) : (
  <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[440px] animate-pulse" />
)}
```

The v1 "Monte Carlo Asset Spread" table stays where it is for now — we replace it in Phase 4.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Spouse fields live directly on `ClientInfo` as `spouseRetirementAge?`, `spouseDob?`, etc. (types.ts:43–46) — there is no separate `spouse` object on `ClientData`.

- [ ] **Step 4: Visual check**

`npm run dev -- -p 3001`, load `/clients/<id>/monte-carlo`, confirm:
- Fan chart renders with gray outer band, green inner band, emerald median line.
- Dashed slate line for deterministic projection is visible and differs from the median when there's randomization.
- Three terminal callouts at the right edge (p95 / p50 / p5) show correct dollar amounts.
- Retirement-age vertical dashed marker appears at the right age.
- Custom legend in the top-right reads Lower Bounds / Higher Outcomes / Median / Cash Flow.

- [ ] **Step 5: Commit (CHECKPOINT 2)**

```bash
git add src/components/monte-carlo-report.tsx
git commit -m "feat(monte-carlo): wire fan chart with deterministic overlay into report (v2 checkpoint 2)"
```

**Stop and show the user. Don't advance to Phase 3 until they approve checkpoint 2.**

---

## Phase 3 — Right rail (CHECKPOINT 3)

### Task 12: Findings card

**Files:**
- Create: `src/components/monte-carlo/findings-card.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/monte-carlo/findings-card.tsx`:

```tsx
import type { MonteCarloSummary } from "@/engine";
import { formatShortCurrency, formatPercent } from "./lib/format";

interface FindingsCardProps {
  summary: MonteCarloSummary;
  deterministicEnding: number | undefined;
}

export function FindingsCard({ summary, deterministicEnding }: FindingsCardProps) {
  const failureRate = summary.failureRate;
  const failCount = Math.round(failureRate * summary.trialsRun);
  const median = summary.ending.p50;
  const delta = deterministicEnding != null ? median - deterministicEnding : null;

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <h3 className="text-sm font-semibold text-slate-100 mb-3">Key Findings & Insights</h3>
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Probability of Failure</div>
          <div className="text-2xl font-semibold text-rose-300 tabular-nums">{formatPercent(failureRate)}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {failCount.toLocaleString()} of {summary.trialsRun.toLocaleString()} trials ran out of money
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Est. Median Value</div>
          <div className="text-2xl font-semibold text-slate-100 tabular-nums">{formatShortCurrency(median)}</div>
          {delta != null ? (
            <div
              className={
                delta >= 0
                  ? "text-[11px] text-emerald-300 tabular-nums mt-0.5"
                  : "text-[11px] text-rose-300 tabular-nums mt-0.5"
              }
            >
              {delta >= 0 ? "+" : ""}{formatShortCurrency(delta)} vs cash-flow projection
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/findings-card.tsx
git commit -m "feat(monte-carlo): findings card — failure % + median delta vs cash-flow"
```

---

### Task 13: Top-risks card

**Files:**
- Create: `src/components/monte-carlo/top-risks-card.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/monte-carlo/top-risks-card.tsx`:

```tsx
import type { TopRisk } from "./lib/top-risks";

const TONE_DOT: Record<TopRisk["tone"], string> = {
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
};

const TONE_TEXT: Record<TopRisk["tone"], string> = {
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  rose: "text-rose-300",
};

interface TopRisksCardProps {
  risks: TopRisk[];
}

export function TopRisksCard({ risks }: TopRisksCardProps) {
  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <h3 className="text-sm font-semibold text-slate-100 mb-3">Top Risks</h3>
      {risks.length === 0 ? (
        <p className="text-[13px] text-slate-500">No elevated risks detected.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {risks.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[r.tone]}`} />
              <span className={TONE_TEXT[r.tone]}>{r.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/top-risks-card.tsx
git commit -m "feat(monte-carlo): top-risks card"
```

---

### Task 14: Recommendations card (empty state with inline SVG sparkle)

**Files:**
- Create: `src/components/monte-carlo/recommendations-card.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/monte-carlo/recommendations-card.tsx`:

```tsx
// Inline SVG sparkle — lucide-react is not installed in this repo; adding a
// dep for a single icon isn't worth it. If lucide later lands in package.json,
// swap this for <Sparkles />.
function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3L12 3z" />
      <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
    </svg>
  );
}

export function RecommendationsCard() {
  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4 relative min-h-[140px]">
      <h3 className="text-sm font-semibold text-slate-100 mb-2">Recommendations</h3>
      {/* TODO: advisor-generated content */}
      <p className="text-sm text-slate-300">AI-generated recommendations coming soon.</p>
      <p className="text-[12px] text-slate-500 mt-1">
        Advisor insights will appear here based on your plan&apos;s risk profile.
      </p>
      <div className="absolute bottom-3 right-3 text-emerald-300/70">
        <SparkleIcon />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/recommendations-card.tsx
git commit -m "feat(monte-carlo): recommendations card — empty state with inline sparkle"
```

---

### Task 15: Wire the right rail into the orchestrator with full grid (CHECKPOINT 3)

**Files:**
- Modify: `src/components/monte-carlo-report.tsx`

- [ ] **Step 1: Add imports and compute top risks**

At the top of the file, add:

```tsx
import { FindingsCard } from "./monte-carlo/findings-card";
import { TopRisksCard } from "./monte-carlo/top-risks-card";
import { RecommendationsCard } from "./monte-carlo/recommendations-card";
import { computeTopRisks } from "./monte-carlo/lib/top-risks";
```

Inside the component body:

```tsx
const topRisks = useMemo(() => {
  if (!summary || !clientData) return [];
  return computeTopRisks(summary, clientData, clientData.planSettings);
}, [summary, clientData]);

const deterministicEnding = deterministic?.[deterministic.length - 1];
```

- [ ] **Step 2: Restructure the page to the 2-column grid**

Wrap the existing page content in the new outer grid. Replace the top-level wrapper `<div>` of the report body with:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
  <div className="flex flex-col gap-6 min-w-0">
    {/* existing content: ReportHeader, KpiBand, FanChart, v1 table */}
  </div>
  <aside className="flex flex-col gap-4">
    {summary ? (
      <>
        <FindingsCard summary={summary} deterministicEnding={deterministicEnding} />
        <TopRisksCard risks={topRisks} />
        <RecommendationsCard />
      </>
    ) : (
      <>
        <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[140px] animate-pulse" />
        <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[100px] animate-pulse" />
        <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[140px] animate-pulse" />
      </>
    )}
  </aside>
</div>
```

Make sure the header remains inside the left column (not at the top-level outside the grid) so the right rail sits flush alongside it — see the spec's layout diagram.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Visual check**

`npm run dev -- -p 3001`, load `/clients/<id>/monte-carlo`, confirm:
- Two-column layout renders on ≥ lg screens; right rail stacks below on smaller screens.
- Findings card shows probability of failure + median + delta vs cash-flow.
- Top-risks card renders either 0–3 risks or the "No elevated risks" line.
- Recommendations card shows empty state with emerald sparkle glyph bottom-right.

- [ ] **Step 5: Commit (CHECKPOINT 3)**

```bash
git add src/components/monte-carlo-report.tsx
git commit -m "feat(monte-carlo): right rail — findings, top risks, recommendations (v2 checkpoint 3)"
```

**Stop and show the user. Don't advance to Phase 4 until they approve checkpoint 3.**

---

## Phase 4 — Bottom row (histogram + restyled table)

### Task 16: Terminal histogram component

**Files:**
- Create: `src/components/monte-carlo/terminal-histogram.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/monte-carlo/terminal-histogram.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import { buildHistogramSeries } from "./lib/terminal-histogram-series";
import { formatShortCurrency, formatInteger } from "./lib/format";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface HistMarkerOptions {
  values: Array<{ x: number; color: string; width: number }>;
  bins: Array<{ min: number; max: number }>;
}

// Vertical lines at p5 / p50 / p95 positions, drawn on top of the bars.
const histMarkersPlugin = {
  id: "histMarkers",
  afterDatasetsDraw(
    chart: {
      ctx: CanvasRenderingContext2D;
      chartArea: { top: number; bottom: number };
      scales: { x: { getPixelForValue(v: number): number } };
    },
    _args: unknown,
    options: HistMarkerOptions,
  ) {
    if (!options?.values || options.bins.length === 0) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    for (const m of options.values) {
      // Find the bin index whose range contains the marker value.
      let idx = options.bins.findIndex((b) => m.x >= b.min && m.x <= b.max);
      if (idx < 0) idx = m.x < options.bins[0].min ? 0 : options.bins.length - 1;
      const x = scales.x.getPixelForValue(idx);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.width;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
};

ChartJS.register(histMarkersPlugin);

interface TerminalHistogramProps {
  endingValues: number[];
  trialsRun: number;
}

export function TerminalHistogram({ endingValues, trialsRun }: TerminalHistogramProps) {
  const series = useMemo(() => buildHistogramSeries(endingValues), [endingValues]);

  if (series.bins.length === 0) {
    return (
      <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Ending Portfolio Distribution</h3>
        <p className="text-sm text-slate-500">No trial data available.</p>
      </section>
    );
  }

  const data = {
    labels: series.bins.map((b) => formatShortCurrency((b.min + b.max) / 2)),
    datasets: [
      {
        label: "Count",
        data: series.bins.map((b) => b.count),
        backgroundColor: "rgba(52, 211, 153, 0.6)",
        borderWidth: 0,
        barPercentage: 1,
        categoryPercentage: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(2, 6, 23, 0.92)",
        titleColor: "rgb(226, 232, 240)",
        bodyColor: "rgb(203, 213, 225)",
        callbacks: {
          title: (items: Array<{ dataIndex: number }>) => {
            const b = series.bins[items[0]?.dataIndex ?? 0];
            return `${formatShortCurrency(b.min)} – ${formatShortCurrency(b.max)}`;
          },
          label: (ctx: { parsed: { y: number } }) => `${ctx.parsed.y} trials`,
        },
      },
      histMarkers: {
        bins: series.bins,
        values: [
          { x: series.p5, color: "rgb(251, 113, 133)", width: 1 },
          { x: series.p50, color: "rgb(110, 231, 183)", width: 2 },
          { x: series.p95, color: "rgb(148, 163, 184)", width: 1 },
        ],
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: "rgb(148, 163, 184)",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6,
        },
      },
      y: { display: false, grid: { display: false } },
    },
  };

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-100">Ending Portfolio Distribution</h3>
        <span className="text-[11px] text-slate-500">N = {formatInteger(trialsRun)} trials</span>
      </div>
      <div className="h-[220px]">
        <Bar data={data} options={options} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/terminal-histogram.tsx
git commit -m "feat(monte-carlo): terminal-histogram chart with p5/p50/p95 markers"
```

---

### Task 17: Restyled yearly breakdown table

**Files:**
- Create: `src/components/monte-carlo/yearly-breakdown.tsx`

The v1 "Monte Carlo Asset Spread" table in `src/components/monte-carlo-report.tsx:253–292` renders these 7 columns: Year, Age, Above Avg. Market (p80 + CAGR), Average Market (p50 + CAGR), Below Avg. Market (p20 + CAGR). User's direction was "keep the table we have but make it look cleaner" — so we preserve those columns exactly, only restyle.

CAGR values come from `summary.byYear[i].cagrFromStart?.{p80|p50|p20}`. The field can be `null` (engine contract — the first year has no elapsed time to annualize); render a dash in that case.

- [ ] **Step 1: Create the component with v1's columns**

Create `src/components/monte-carlo/yearly-breakdown.tsx`:

```tsx
import type { MonteCarloSummary } from "@/engine";
import { formatShortCurrency, formatPercent } from "./lib/format";

interface YearlyBreakdownProps {
  summary: MonteCarloSummary;
}

function formatCagr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPercent(value);
}

export function YearlyBreakdown({ summary }: YearlyBreakdownProps) {
  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 overflow-hidden">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold text-slate-100">Monte Carlo Asset Spread</h3>
        <span className="text-[11px] text-slate-500">Percentile balances by year</span>
      </div>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2 text-left font-medium">Year</th>
              <th className="px-4 py-2 text-left font-medium">Age</th>
              <th className="px-4 py-2 text-right font-medium">Above Avg. (p80)</th>
              <th className="px-4 py-2 text-right font-medium text-slate-500">CAGR</th>
              <th className="px-4 py-2 text-right font-medium">Average (p50)</th>
              <th className="px-4 py-2 text-right font-medium text-slate-500">CAGR</th>
              <th className="px-4 py-2 text-right font-medium">Below Avg. (p20)</th>
              <th className="px-4 py-2 text-right font-medium text-slate-500">CAGR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {summary.byYear.map((y) => {
              const age = y.age.spouse != null ? `${y.age.client} / ${y.age.spouse}` : `${y.age.client}`;
              return (
                <tr key={y.year} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2 text-slate-200">{y.year}</td>
                  <td className="px-4 py-2 text-slate-400">{age}</td>
                  <td className="px-4 py-2 text-right text-slate-300 tabular-nums">{formatShortCurrency(y.balance.p80)}</td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">{formatCagr(y.cagrFromStart?.p80)}</td>
                  <td className="px-4 py-2 text-right text-emerald-300 tabular-nums">{formatShortCurrency(y.balance.p50)}</td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">{formatCagr(y.cagrFromStart?.p50)}</td>
                  <td className="px-4 py-2 text-right text-slate-300 tabular-nums">{formatShortCurrency(y.balance.p20)}</td>
                  <td className="px-4 py-2 text-right text-slate-500 tabular-nums">{formatCagr(y.cagrFromStart?.p20)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

`formatPercent` already exists from Task 1 but was written for 0–1 fractions. The engine's `cagrFromStart.pXX` is also a decimal fraction (e.g., `0.052` = 5.2%), so we can reuse it as-is; the `formatCagr` wrapper just adds the `null`-safe dash fallback.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/yearly-breakdown.tsx
git commit -m "feat(monte-carlo): yearly breakdown table — cleaned surface + typography"
```

---

### Task 18: Wire the bottom row into the orchestrator and retire v1 leftovers

**Files:**
- Modify: `src/components/monte-carlo-report.tsx`

- [ ] **Step 1: Compute ending-value array**

Near the other `useMemo`s in the component body, add:

```tsx
const endingValues = useMemo(() => {
  if (!lastResult) return [];
  const last = lastResult.byYearLiquidAssetsPerTrial.at(-1);
  return last ?? [];
}, [lastResult]);
```

This requires keeping a ref to the raw MC result. Find where `summary` is set (after `summarizeMonteCarlo(...)` runs); alongside it, also `setLastResult(result)`. Add the state:

```tsx
const [lastResult, setLastResult] = useState<import("@/engine").MonteCarloResult | null>(null);
```

…and include `setLastResult(null)` in the cross-client state-reset block so client switches clear it.

- [ ] **Step 2: Render the bottom row and remove the v1 spread table**

Add imports:

```tsx
import { TerminalHistogram } from "./monte-carlo/terminal-histogram";
import { YearlyBreakdown } from "./monte-carlo/yearly-breakdown";
```

In the left column, replace the v1 "Monte Carlo Asset Spread" table block with:

```tsx
{summary ? (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <YearlyBreakdown summary={summary} />
    <TerminalHistogram endingValues={endingValues} trialsRun={summary.trialsRun} />
  </div>
) : (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[320px] animate-pulse" />
    <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[320px] animate-pulse" />
  </div>
)}
```

Also remove (delete) the v1 "Running… X / Y" progress line that lived below the old button row — we surface progress inside the loading skeletons visually. Keep the `handleRun` / `handleRestart` callbacks — both are still called from `ReportHeader`.

If the old all-fixed-rate banner is still mounted somewhere, remove it too (the histogram shape will communicate "everything collapses to one value" visually at a glance).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Visual check**

`npm run dev -- -p 3001`, confirm:
- Bottom-left: Yearly Breakdown table renders with clean dark surface, emerald median column, hover highlight.
- Bottom-right: Histogram renders with green bars, three dashed markers (rose p5, emerald p50, slate p95), "N = 1,000 trials" subtitle.
- Run a plan with all-custom-rate accounts — every trial collapses to one value, the histogram shows a single spike; confirmation the visual tells the story without a banner.

- [ ] **Step 5: Commit**

```bash
git add src/components/monte-carlo-report.tsx
git commit -m "feat(monte-carlo): bottom row — histogram + restyled table; retire v1 leftovers"
```

---

## Phase 5 — Polish, regression tests, documentation

### Task 19: Component smoke test (regression lock for cross-client reset)

**Files:**
- Create: `src/components/monte-carlo/__tests__/monte-carlo-report.test.tsx`

- [ ] **Step 1: Write the smoke test**

Create `src/components/monte-carlo/__tests__/monte-carlo-report.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MonteCarloReport from "../../monte-carlo-report";

// Mock fetch so the component's data-loading effects resolve cleanly.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.includes("/monte-carlo-data")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          seed: 123,
          correlations: [],
          accountMixes: [],
          assetClassReturns: {},
          requiredMinimumAssetLevel: 0,
        }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        client: {
          id: "c1",
          firstName: "Dan",
          displayName: "Dan Sample",
          dateOfBirth: "1965-01-01",
          retirementAge: 65,
          planEndAge: 90,
        },
        planSettings: { planStartYear: 2026, planEndAge: 90, inflationRate: 0.025 },
        incomes: [],
        accounts: [],
        liabilities: [],
        expenses: [],
      }),
    } as Response);
  }));
});

describe("MonteCarloReport smoke", () => {
  it("renders the report scaffold and header without crashing", async () => {
    render(<MonteCarloReport clientId="c1" />);
    await waitFor(() =>
      expect(screen.getByText(/Monte Carlo Simulation: Retirement Forecast/i)).toBeInTheDocument(),
    );
  });

  it("clears the header subtitle when clientId changes (cross-client reset regression)", async () => {
    const { rerender } = render(<MonteCarloReport clientId="c1" />);
    await waitFor(() => expect(screen.getByText(/Dan Sample/i)).toBeInTheDocument());

    (fetch as unknown as vi.Mock).mockImplementationOnce((url: string) => {
      if (url.includes("/monte-carlo-data")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ seed: 456, correlations: [], accountMixes: [], assetClassReturns: {}, requiredMinimumAssetLevel: 0 }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          client: { id: "c2", firstName: "Cooper", displayName: "Cooper Sample", dateOfBirth: "1970-01-01", retirementAge: 65, planEndAge: 90 },
          planSettings: { planStartYear: 2026, planEndAge: 90, inflationRate: 0.025 },
          incomes: [], accounts: [], liabilities: [], expenses: [],
        }),
      } as Response);
    });
    rerender(<MonteCarloReport clientId="c2" />);

    // At the tick immediately after clientId change, state reset must have cleared
    // the previous client's derived data before the new fetch resolves.
    await waitFor(() => expect(screen.queryByText(/Dan Sample/i)).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `npm test -- src/components/monte-carlo/__tests__/monte-carlo-report.test.tsx`
Expected: PASS. Note: the existing timeline test file failures (pre-existing) are unrelated and unaffected.

If the test fails because the test runner can't resolve the `MonteCarloReport` default export, check the actual import in the orchestrator file and fix the test's import statement. Do NOT add a new export to the orchestrator.

- [ ] **Step 3: Commit**

```bash
git add src/components/monte-carlo/__tests__/monte-carlo-report.test.tsx
git commit -m "test(monte-carlo): orchestrator smoke + cross-client reset regression"
```

---

### Task 20: Document deferred work

**Files:**
- Modify: `docs/FUTURE_WORK.md`

- [ ] **Step 1: Read the current file**

Run: `cat docs/FUTURE_WORK.md` (or use Read). Note the style (bullets, "Why deferred" notes).

- [ ] **Step 2: Append the v2 deferred items**

Append to `docs/FUTURE_WORK.md`:

```markdown
## Monte Carlo v2 — deferred

- Interactive Variables / what-if panel on the MC report. Why deferred: what-if editing is a distinct feature from MC rendering; needs its own spec.
- "View Scenario" CTA on the MC report header. Why deferred: destination route not yet defined; button renders visible-but-disabled.
- AI-generated recommendations card content. Why deferred: advisor-authored content layer, not code-generated.
- Top Risks — real attribution engine. Why deferred: v2 uses static heuristics (inflation > 3.5%, early-bear p5 at year 10, planEndAge > 95); real attribution needs sensitivity analysis.
- Web Worker execution for MC trials. Why deferred: main-thread with yieldEvery:50 is adequate at 1k trials; revisit at 10k.
- Correlation matrix admin UI. Why deferred: DB edits only for now; no user demand yet.
- Per-plan requiredMinimumAssetLevel column. Why deferred: hardcoded to 0 in /api/clients/[id]/monte-carlo-data; add a plan_settings column when prioritized.
- Inflation randomization. Why deferred: inflation-tied accounts stay fixed-rate per v1 scoping.
```

- [ ] **Step 3: Commit**

```bash
git add docs/FUTURE_WORK.md
git commit -m "docs(monte-carlo): log v2 deferred items"
```

---

### Task 21: Final verification (typecheck + full test suite + visual walkthrough)

**Files:** (no edits, verification only)

- [ ] **Step 1: Clean typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from anywhere under `src/`.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected:
- All Monte Carlo helper tests pass (Tasks 1–4, 6).
- Orchestrator smoke test passes (Task 19).
- 659 engine tests pass unchanged.
- The three pre-existing `timeline-report-view.test.tsx` failures remain unchanged (known, pre-MC, tracked separately). Nothing else should be red.

- [ ] **Step 3: Visual walkthrough**

`npm run dev -- -p 3001`, navigate to `/clients/<id>/monte-carlo` for at least two different clients:
- First load: skeletons → populated within ~5s.
- All 7 regions render (header, KPI band, fan chart, findings, risks, recommendations, histogram, table).
- "New Seed" re-runs; all visuals update together.
- Switching clients: no stale content from prior client (regression check).
- Below `lg` breakpoint: right rail collapses under the main column; bottom row collapses to a single column.

- [ ] **Step 4: Commit final verification note (optional, only if anything changed)**

If any tweaks were needed during verification, commit them with a descriptive message. Otherwise no commit.

---

## Summary

- **Tasks 1–4** — pure helpers (format, top-risks, fan-chart series, histogram series), all TDD.
- **Tasks 5–9** — KPI band + header. **Checkpoint 1.**
- **Tasks 10–11** — fan chart with deterministic overlay + age markers + terminal callouts. **Checkpoint 2.**
- **Tasks 12–15** — right rail (findings, top risks, recommendations). **Checkpoint 3.**
- **Tasks 16–18** — terminal histogram, restyled table, retire v1 leftovers.
- **Tasks 19–21** — smoke test, docs, final verification.

Each checkpoint is its own commit; stop at each and show the user before continuing.
