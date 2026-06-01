import { colors, colorsLight, data, dataLight, dataScale } from "@/brand";
import type { Theme } from "@/lib/theme";

// Pure, framework-free chart color helpers — safe to import from server code
// (PDF renderers, lib modules, API routes). The client-only theme hooks live
// in `./chart-colors` (which re-exports everything here).

// Series order so neighbors cross hue families (orange · green · gold · cyan ·
// pink · blue …), keeping look-alike pairs (sage/emerald, slate/indigo,
// terra/wheat) non-adjacent — see foundry-design SKILL.md "Series order".
const ADJACENCY = [
  "terra",
  "emerald",
  "wheat",
  "slate",
  "rose",
  "indigo",
  "sage",
  "violet",
  "amber",
] as const;

/**
 * The series colors for a chart with `n` series, in adjacency order. Uses the
 * nine named editorial hues while `n <= 9`; beyond that, appends in-band
 * `dataScale` hues so the set still reads as one family.
 */
export function chartSeriesColors(n: number, theme: Theme = "dark"): string[] {
  const palette = theme === "light" ? dataLight : data;
  const named = ADJACENCY.map((key) => palette[key]);
  if (n <= named.length) return named.slice(0, n);
  return [...named, ...dataScale(n - named.length, theme)];
}

/** The editorial data palette (nine named hues) for a theme. */
export function dataPalette(theme: Theme) {
  return theme === "light" ? dataLight : data;
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
