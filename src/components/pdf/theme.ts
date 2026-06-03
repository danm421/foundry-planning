// PDF-side theme tokens, derived from the canonical brand light palette
// (src/brand/index.ts) so reports never drift from the app. @react-pdf/renderer
// takes inline color strings, not CSS variables, so we resolve to hex here.

import { colorsLight } from "@/brand";
import { chartSeriesColors } from "@/lib/chart-palette";

export const PDF_THEME = {
  paper: colorsLight.paper,   // #fefdf8
  card2: "#ffffff",           // raised white panel on cream paper (print affordance)
  ink: colorsLight.ink,       // #1a1d27
  ink2: colorsLight.ink2,     // #474c59
  ink3: colorsLight.ink3,     // #767a86
  hair: colorsLight.hair,     // #e8e4d6
  accent: colorsLight.accent, // #d97706 (firm override applied via resolveAccentColor)
  good: colorsLight.good,     // #047857
  warn: colorsLight.warn,     // #b45309
  crit: colorsLight.crit,     // #b91c1c
  chart: chartSeriesColors(6, "light"), // Deep Jewel light adjacency: red·blue·green·yellow·grey·orange
} as const;

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Returns `color` if it is a 6-digit hex string, else `PDF_THEME.accent`.
 *  Color validation matches the write-side check on `firms.primaryColor`. */
export function resolveAccentColor(color: string | null | undefined): string {
  if (color && HEX6.test(color)) return color;
  return PDF_THEME.accent;
}
