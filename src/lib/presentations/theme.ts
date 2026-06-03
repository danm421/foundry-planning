// Framework-free theme tokens for the Presentations subsystem, derived from the
// canonical brand light palette (src/brand/index.ts). @react-pdf/renderer takes
// inline color strings, so we resolve to hex here.

import { colorsLight, dataLight } from "@/brand";

export const PRESENTATION_THEME = {
  paper: colorsLight.paper,   // #fefdf8
  card: "#ffffff",            // raised white panel on cream paper (print affordance)
  ink: colorsLight.ink,       // #1a1d27
  ink2: colorsLight.ink2,     // #474c59
  ink3: colorsLight.ink3,     // #767a86
  hair: colorsLight.hair,     // #e8e4d6
  accent: colorsLight.accent, // #d97706
  good: colorsLight.good,     // #047857
  crit: colorsLight.crit,     // #b91c1c
  // Secondary tokens shared across presentation pages.
  steel: dataLight.blue,      // brand data blue (#2d61aa); was bespoke #3b6ea3
  accentMuted: "#e3a857",     // soft amber, harmonized with #d97706 (was gold-derived #d4a86a)
  accentTint: "#f8e9cf",      // pale amber wash (was gold-derived #f4e6c8)
  // Cash-flow stacked-bar palette in render order — Deep Jewel light:
  //   [Social Security, Salaries, Other Inflows, RMDs, Withdrawals].
  chartStack: [
    dataLight.blue,
    dataLight.green,
    dataLight.teal,
    dataLight.orange,
    dataLight.red,
  ],
  // Total Expenses overlay line — brand ink, pops on light paper.
  chartLine: colorsLight.ink, // #1a1d27
} as const;

export type PresentationTheme = typeof PRESENTATION_THEME;
