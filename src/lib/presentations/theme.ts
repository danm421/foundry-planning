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
  accent: colorsLight.accent, // #0f7d6c (verdigris, v2.2)
  good: colorsLight.good,     // #047857
  crit: colorsLight.crit,     // #b91c1c
  // Secondary tokens shared across presentation pages.
  steel: dataLight.blue,      // brand data blue (#2d61aa); was bespoke #3b6ea3
  accentMuted: "#5fa597",     // soft verdigris, harmonized with #0f7d6c
  accentTint: "#e4f1ec",      // pale verdigris wash
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

// Verdigris brand pair — the default for unmapped categories and the page-frame thread.
export const DEFAULT_ACCENT: SectionAccent = {
  accent: PRESENTATION_THEME.accent,    // #0f7d6c
  tint: PRESENTATION_THEME.accentTint,  // #e4f1ec
};

// Keyed by PresentationCategory string (kept decoupled from the registry to
// preserve theme.ts purity; theme-accents.test.ts asserts full coverage).
// Accents reference the canonical brand `dataLight` Deep Jewel hues (single
// source of truth); tints are hand-picked pale, print-safe washes of each.
export const SECTION_ACCENTS: Record<string, SectionAccent> = {
  Framing:       DEFAULT_ACCENT,                                 // verdigris (brand)
  "Cash Flow":   { accent: dataLight.blue,   tint: "#e7eef7" },  // blue
  "Income Tax":  { accent: dataLight.orange, tint: "#f8e8db" },  // orange
  Assets:        { accent: dataLight.teal,   tint: "#dbeeea" },  // teal
  Insurance:     { accent: dataLight.green,  tint: "#dcefe4" },  // green
  Estate:        { accent: dataLight.purple, tint: "#ece4f4" },  // purple
  "Monte Carlo": { accent: dataLight.pink,   tint: "#f5e3ea" },  // pink
  Retirement:    { accent: dataLight.yellow, tint: "#f5ecd2" },  // gold
  Comparison:    { accent: dataLight.grey,   tint: "#ececef" },  // grey
};

// Neutral warm stripe for alternating data rows — color identity lives in the
// header band, not the rows.
export const ZEBRA_FILL = "#faf6ea";
