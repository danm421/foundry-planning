import { useEffect, useState } from "react";
import { colors, colorsLight, data, dataLight, dataScale } from "@/brand";
import type { Theme } from "@/lib/theme";

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

/**
 * Client hook: tracks the live app theme by subscribing to the `data-theme`
 * attribute on <html>, so Chart.js configs (which paint to canvas and can't
 * read CSS vars) recolor on toggle without a reload. Initial render is "dark"
 * to match SSR; corrected on mount.
 */
export function useThemeName(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/**
 * Client hook: returns a `chartSeriesColors`-bound accessor that re-derives
 * when the app theme toggles.
 */
export function useChartColors(): (n: number) => string[] {
  const theme = useThemeName();
  return (n: number) => chartSeriesColors(n, theme);
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
