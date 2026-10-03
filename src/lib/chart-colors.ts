"use client";

import { useEffect, useState } from "react";
import { resolveTheme, DEFAULT_THEME, type Theme } from "@/lib/theme";
import { chartSeriesColors } from "./chart-palette";

// Re-export the pure helpers so existing client imports keep working from one
// place. Server/PDF/lib code must import these from `./chart-palette` directly
// (this module is client-only because of the theme hooks below).
export {
  bracketFloorColor,
  chartChrome,
  chartSeriesColors,
  dataPalette,
  statusColors,
} from "./chart-palette";
export type { ChartChrome, DataColorKey } from "./chart-palette";

/**
 * Client hook: tracks the live app theme by subscribing to the `data-theme`
 * attribute on <html>, so Chart.js configs (which paint to canvas and can't
 * read CSS vars) recolor on toggle without a reload. Initial render matches the
 * default theme's palette, as SSR paints it; corrected on mount.
 */
export function useThemeName(): Theme {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(resolveTheme(root.dataset.theme));
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
