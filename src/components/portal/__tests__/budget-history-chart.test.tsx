// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ChartOptions, Plugin } from "chart.js";

// `react-chartjs-2` hands its `plugins` prop to the Chart CONSTRUCTOR inside a
// mount-only effect and never touches it again; `options` is re-assigned on
// every update (node_modules/react-chartjs-2/dist/index.js). This mock keeps
// that asymmetry exactly, because it is the asymmetry the bug lives in: a
// plugin closed over a prop keeps its first-paint value forever.
const cap = vi.hoisted(() => ({
  plugins: [] as Plugin<"bar">[],
  options: null as ChartOptions<"bar"> | null,
  theme: "dark" as "dark" | "light",
}));

vi.mock("react-chartjs-2", () => ({
  Bar: ({
    options,
    plugins,
  }: {
    options: ChartOptions<"bar">;
    plugins?: Plugin<"bar">[];
  }) => {
    if (cap.plugins.length === 0) cap.plugins = plugins ?? []; // constructor-only
    cap.options = options; // re-assigned on update
    return <div data-testid="chart" />;
  },
}));
vi.mock("chart.js", () => ({
  Chart: { register: () => {} },
  BarElement: {},
  CategoryScale: {},
  LinearScale: {},
  Tooltip: {},
}));
vi.mock("@/lib/chart-colors", () => ({
  useThemeName: () => cap.theme,
  // Real ink/card hexes from src/brand — dark and light differ, so a stale
  // colour is visible as the wrong theme's hex rather than an invented string.
  chartChrome: (theme: string) =>
    theme === "light"
      ? { tick: "#6b7280", grid: "#e5e7eb", legend: "#374151", title: "#111827", tooltipBg: "#ffffff", tooltipTitle: "#111827", tooltipBody: "#374151" }
      : { tick: "#9ca3af", grid: "#1f2937", legend: "#d1d5db", title: "#f9fafb", tooltipBg: "#111827", tooltipTitle: "#f9fafb", tooltipBody: "#d1d5db" },
  dataPalette: () => ({ grey: "#9ca3af", blue: "#2c5fa8" }),
  statusColors: () => ({ good: "#1f9e8c", warn: "#d0a215", crit: "#c2410c" }),
}));

import { BudgetHistoryChart } from "@/components/portal/budget-history-chart";
import type { HistoryBar } from "@/lib/portal/category-detail";

const HISTORY: HistoryBar[] = [
  { month: "2026-05", amount: 180, heat: "good" },
  { month: "2026-06", amount: 240, heat: "warn" },
  { month: "2026-07", amount: 310, heat: "crit" },
];

/** What the budget-line plugin actually painted on this pass. */
interface Painted {
  /** Data-space y values the line was asked to position at. */
  values: number[];
  /** Text drawn in the right-edge pill. */
  texts: string[];
  /** Stroke colours used, in order. */
  strokes: string[];
}

/**
 * Drive the plugin the way Chart.js does on a redraw: it receives the chart,
 * and its own slice of the *current* options — never the props that were in
 * scope when the plugin object was built.
 */
function draw(): Painted {
  const painted: Painted = { values: [], texts: [], strokes: [] };
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    roundRect: () => {},
    fill: () => {},
    stroke() {
      painted.strokes.push(String(ctx.strokeStyle));
    },
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillText: (t: string) => {
      painted.texts.push(t);
    },
    strokeStyle: "",
    fillStyle: "",
    font: "",
    lineWidth: 0,
    textBaseline: "",
    textAlign: "",
  };
  const chart = {
    ctx,
    chartArea: { left: 0, right: 300, top: 0, bottom: 128 },
    scales: {
      y: {
        getPixelForValue: (v: number) => {
          painted.values.push(v);
          return 64;
        },
      },
    },
  };
  const plugin = cap.plugins.find((p) => p.id === "budgetLine");
  expect(plugin, "the chart must register a budgetLine plugin").toBeDefined();
  const opts = (cap.options?.plugins as Record<string, unknown> | undefined)?.budgetLine;
  plugin?.afterDatasetsDraw?.(
    chart as never,
    { cancelable: false } as never,
    opts as never,
    {} as never,
  );
  return painted;
}

beforeEach(() => {
  cap.plugins = [];
  cap.options = null;
  cap.theme = "dark";
});

describe("BudgetHistoryChart budget line", () => {
  it("draws the line and pill at the budget it was given", () => {
    render(<BudgetHistoryChart history={HISTORY} budget={200} categoryColor="var(--data-blue)" />);

    const painted = draw();
    expect(painted.values).toEqual([200]);
    expect(painted.texts).toEqual(["$200"]);
  });

  it("draws nothing when there is no budget", () => {
    render(<BudgetHistoryChart history={HISTORY} budget={null} categoryColor="var(--data-blue)" />);

    expect(draw().values).toEqual([]);
  });

  // The panel re-pulls its detail in place after a save — same categoryId, so
  // nothing remounts. Before this was fixed the bars rescaled and the
  // "remaining" figure updated while the reference line stayed on the old
  // number, which is the one thing the client is reading the chart against.
  it("follows an edited budget without a remount", () => {
    const { rerender } = render(
      <BudgetHistoryChart history={HISTORY} budget={200} categoryColor="var(--data-blue)" />,
    );
    rerender(
      <BudgetHistoryChart history={HISTORY} budget={500} categoryColor="var(--data-blue)" />,
    );

    const painted = draw();
    expect(painted.values).toEqual([500]);
    expect(painted.texts).toEqual(["$500"]);
  });

  // "Set budget" on a category that had none: null → 300 with no remount.
  it("appears when a first budget is set without a remount", () => {
    const { rerender } = render(
      <BudgetHistoryChart history={HISTORY} budget={null} categoryColor="var(--data-blue)" />,
    );
    rerender(
      <BudgetHistoryChart history={HISTORY} budget={300} categoryColor="var(--data-blue)" />,
    );

    expect(draw().values).toEqual([300]);
  });

  it("recolors with the theme without a remount", () => {
    const { rerender } = render(
      <BudgetHistoryChart history={HISTORY} budget={200} categoryColor="var(--data-blue)" />,
    );
    const darkStrokes = draw().strokes;
    expect(darkStrokes[0]).toBe("#f9fafb"); // dark ink

    cap.theme = "light";
    rerender(
      <BudgetHistoryChart history={HISTORY} budget={200} categoryColor="var(--data-blue)" />,
    );

    expect(draw().strokes[0]).toBe("#111827"); // light ink
  });
});
