import { colors, colorsLight, data, dataLight, dataScale } from "@/brand";
import type { DataColorKey } from "@/brand";
import type { Theme } from "@/lib/theme";

export type { DataColorKey };

// Pure, framework-free chart color helpers — safe to import from server code
// (PDF renderers, lib modules, API routes). The client-only theme hooks live
// in `./chart-colors` (which re-exports everything here).

// Deep Jewel series order: lead with the six anchors (red · blue · green ·
// yellow · grey · orange), then draw on the fills (purple · teal · pink) as
// series grow — see foundry-design SKILL.md "Series order".
const ADJACENCY: readonly DataColorKey[] = [
  "red",
  "blue",
  "green",
  "yellow",
  "grey",
  "orange",
  "purple",
  "teal",
  "pink",
] as const;

/**
 * The series colors for a chart with `n` series, in adjacency order. Uses the
 * nine named Deep Jewel hues while `n <= 9`; beyond that, appends in-band
 * `dataScale` hues so the set still reads as one family.
 */
export function chartSeriesColors(n: number, theme: Theme = "dark"): string[] {
  const palette = theme === "light" ? dataLight : data;
  const named = ADJACENCY.map((key) => palette[key]);
  if (n <= named.length) return named.slice(0, n);
  return [...named, ...dataScale(n - named.length, theme)];
}

/** The Deep Jewel data palette (nine named hues) for a theme. */
export function dataPalette(theme: Theme) {
  return theme === "light" ? dataLight : data;
}

/**
 * Theme-aware status colors (good / warn / crit) as real hex — for Chart.js
 * series that signal status on canvas (e.g. a marginal-rate ceiling line),
 * which can't read the CSS status vars.
 */
export function statusColors(theme: Theme) {
  const c = theme === "light" ? colorsLight : colors;
  return { good: c.good, warn: c.warn, crit: c.crit };
}

export interface ChartChrome {
  tick: string;
  grid: string;
  legend: string;
  title: string;
  tooltipBg: string;
  tooltipTitle: string;
  tooltipBody: string;
}

/** Theme-aware Chart.js chrome colors (axes, gridlines, legend, tooltip). */
export function chartChrome(theme: Theme): ChartChrome {
  const c = theme === "light" ? colorsLight : colors;
  return {
    tick: c.ink3,
    grid: c.hair,
    legend: c.ink2,
    title: c.ink,
    tooltipBg: c.card,
    tooltipTitle: c.ink,
    tooltipBody: c.ink2,
  };
}
