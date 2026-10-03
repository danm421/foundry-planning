/**
 * The two charts that draw annotation lines register chartjs-plugin-annotation
 * globally when their module loads — and that can happen after other charts
 * are already drawn: the annuity preview arrives inside the account editor the
 * Solver's Changes tab opens through next/dynamic. A global plugin joins EVERY
 * live chart at its next update or draw, but the plugin builds its per-chart
 * state only in `beforeInit`, which Chart.js runs once, at construction. A
 * Solver chart already on screen when the editor loaded crashed on its next
 * update ("Cannot set properties of undefined (setting 'annotations')") and
 * took the whole Solver down with it. The Medicare tier chart registers the
 * same way, so it carries the same hazard.
 *
 * Default (node) environment on purpose: with no DOM, Chart.js runs on its
 * BasicPlatform, so a real @napi-rs/canvas backs each chart and every plugin
 * hook runs for real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import type { Chart as ChartType, ChartOptions } from "chart.js";

const ANNOTATION_MODULES = [
  ["annuity-preview-chart", () => import("@/components/forms/annuity-preview-chart")],
  [
    "medicare-magi-tier-chart",
    () => import("@/components/cashflow/medicare/medicare-magi-tier-chart"),
  ],
] as const;

/** Stands in for a chart the page drew before the module loaded — a Solver
 *  chart, which knows nothing about annotations. */
async function drawLineChart(options: ChartOptions<"line"> = {}): Promise<ChartType<"line">> {
  const { Chart, CategoryScale, LineController, LineElement, LinearScale, PointElement } =
    await import("chart.js");
  Chart.register(CategoryScale, LineController, LineElement, LinearScale, PointElement);
  return new Chart(createCanvas(400, 200) as unknown as HTMLCanvasElement, {
    type: "line",
    data: { labels: ["2026", "2027", "2028"], datasets: [{ data: [3, 2, 1] }] },
    options: { responsive: false, animation: false, ...options },
  });
}

const crossoverLine = {
  annotations: {
    crossover: {
      type: "line" as const,
      xMin: 1,
      xMax: 1,
      label: { display: true, content: "Balance gone", position: "start" as const },
    },
  },
};

async function annotationsOn(chart: ChartType<"line">) {
  const { default: annotationPlugin } = await import("chartjs-plugin-annotation");
  // getAnnotations takes an untyped `Chart`. Whether TypeScript accepts a
  // Chart<"line"> there depends on the order it checks files in — a full check
  // passes, Vercel's cached incremental one fails — so widen it explicitly.
  return annotationPlugin.getAnnotations(chart as unknown as ChartType);
}

afterEach(async () => {
  // chart.js is a node_modules package, so its registry outlives
  // `vi.resetModules()`; empty it by hand so each test starts from a page
  // that has never loaded an annotation chart.
  const { Chart } = await import("chart.js");
  for (const chart of Object.values(Chart.instances)) chart.destroy();
  const annotation = Chart.registry.plugins.get("annotation");
  if (annotation) Chart.unregister(annotation);
  // …and forget the module under test, so the next import re-runs its
  // top-level registration.
  vi.resetModules();
});

describe.each(ANNOTATION_MODULES)("loading %s after a chart is on screen", (_name, load) => {
  it.each(["update", "render"] as const)("leaves that chart able to %s", async (method) => {
    const chart = await drawLineChart();
    await load();
    expect(() => chart[method]()).not.toThrow();
  });

  it("lets that chart draw an annotation it is given afterwards", async () => {
    const chart = await drawLineChart();
    await load();
    chart.options.plugins = { ...chart.options.plugins, annotation: crossoverLine };
    chart.update();
    const [line] = await annotationsOn(chart);
    expect(line.options).toMatchObject({
      display: true,
      drawTime: "afterDatasetsDraw",
      label: { display: true, content: "Balance gone" },
    });
  });

  it("still draws annotations on a chart created after it loads", async () => {
    await load();
    const chart = await drawLineChart({ plugins: { annotation: crossoverLine } });
    const [line] = await annotationsOn(chart);
    expect(line.options).toMatchObject({ display: true, drawTime: "afterDatasetsDraw" });
  });
});
