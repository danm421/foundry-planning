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

export type SectionAccent = { accent: string; tint: string };

// Amber brand pair — the default for unmapped categories and the page-frame thread.
export const DEFAULT_ACCENT: SectionAccent = {
  accent: PRESENTATION_THEME.accent,    // #d97706
  tint: PRESENTATION_THEME.accentTint,  // #f8e9cf
};

// Keyed by PresentationCategory string (kept decoupled from the registry to
// preserve theme.ts purity; theme-accents.test.ts asserts full coverage).
// Tints are hand-picked pale, print-safe washes of each Deep Jewel hue.
export const SECTION_ACCENTS: Record<string, SectionAccent> = {
  Framing:       DEFAULT_ACCENT,                          // amber (brand)
  "Cash Flow":   { accent: "#2d61aa", tint: "#e7eef7" },  // blue
  "Income Tax":  { accent: "#cf671d", tint: "#f8e8db" },  // orange
  Assets:        { accent: "#198b83", tint: "#dbeeea" },  // teal
  Insurance:     { accent: "#1f8d5f", tint: "#dcefe4" },  // green
  Estate:        { accent: "#6c41a2", tint: "#ece4f4" },  // purple
  "Monte Carlo": { accent: "#ab3f6b", tint: "#f5e3ea" },  // pink
  Retirement:    { accent: "#c2941b", tint: "#f5ecd2" },  // gold
  Comparison:    { accent: "#878d99", tint: "#ececef" },  // grey
};

// Neutral warm stripe for alternating data rows — color identity lives in the
// header band, not the rows.
export const ZEBRA_FILL = "#faf6ea";
