// src/components/balance-sheet-report/tokens.ts
//
// Shared design tokens for the balance sheet report. Used by both the
// on-screen view (via Tailwind classes) and the PDF document (via react-pdf
// StyleSheet) so the two can't drift apart.

import { colorsLight, dataLight } from "@/brand";

export type AssetCategoryKey =
  | "cash"
  | "taxable"
  | "retirement"
  | "annuity"
  | "realEstate"
  | "business"
  | "stockOptions"
  | "lifeInsurance";

/** Human-readable category labels shown in the UI. */
export const CATEGORY_LABELS: Record<AssetCategoryKey, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  annuity: "Annuity",
  realEstate: "Real Estate",
  business: "Business",
  stockOptions: "Stock Options",
  lifeInsurance: "Life Insurance",
};

/** Category order in the assets panel (left → top, right → bottom). */
export const CATEGORY_ORDER: AssetCategoryKey[] = [
  "cash",
  "taxable",
  "retirement",
  "annuity",
  "realEstate",
  "business",
  "stockOptions",
  "lifeInsurance",
];

/** Hex palette used by the donut chart (both themes) and PDF rendering.
 *  Six distinct Deep Jewel light anchors — matches the app's brand charts. */
export const CATEGORY_HEX: Record<AssetCategoryKey, string> = {
  cash: dataLight.green,            // #1f8d5f
  taxable: dataLight.blue,          // #2d61aa
  retirement: dataLight.red,        // #c5392b — distinct from taxable blue
  annuity: dataLight.orange,        // #cf671d
  realEstate: dataLight.yellow,     // #c2941b
  business: dataLight.pink,         // #ab3f6b
  stockOptions: dataLight.purple,   // #6c41a2 — swapped off red for retirement
  lifeInsurance: dataLight.teal,    // #198b83
};

/** Screen theme. Mirrors PDF_THEME below role-for-role, in token classes.
 *
 *  Currently has no callers — the on-screen components reach for the tokens
 *  directly. Left in place (it is pre-existing) but moved off Tailwind's
 *  default palette with the rest of the app, so reviving it cannot revive the
 *  theme-blind rendering the 2026-09-16 sweep removed. */
export const SCREEN_THEME = {
  surface: {
    panel: "bg-card border border-hair rounded-lg",
    panelHeader: "bg-card-2 px-4 py-3",
    divider: "border-hair",
    netWorthAccent: "bg-card-2 border border-accent/40",
  },
  text: {
    primary: "text-ink",
    secondary: "text-ink-2",
    muted: "text-ink-3",
  },
  status: {
    up: "text-good bg-good/10 border border-good/30",
    down: "text-crit bg-crit/10 border border-crit/30",
    flat: "text-ink-2 bg-card-2 border border-hair-2",
  },
} as const;

/** PDF theme (light, print-friendly). Raw hex values — react-pdf uses CSS-in-JS. */
export const PDF_THEME = {
  surface: {
    page: "#ffffff",
    panel: colorsLight.card,         // #faf8ef
    panelBorder: colorsLight.hair,   // #e8e4d6
    panelHeader: colorsLight.card2,  // #f5f1e6
    divider: colorsLight.hair,       // #e8e4d6
    netWorthAccent: "#fbf3e0",       // pale amber wash for the net-worth panel
    netWorthBorder: "#eccf95",       // soft amber border
  },
  text: {
    primary: colorsLight.ink,        // #1a1d27
    secondary: colorsLight.ink2,     // #474c59
    muted: colorsLight.ink3,         // #5c5f69
  },
  status: {
    up: { bg: "#ecfdf5", fg: colorsLight.good, border: "#a7f3d0" },   // emerald tint
    down: { bg: "#fef2f2", fg: colorsLight.crit, border: "#fecaca" }, // rose tint
    flat: { bg: colorsLight.card2, fg: colorsLight.ink2, border: colorsLight.hair2 }, // neutral
  },
} as const;
