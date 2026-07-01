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

/** Screen theme (dark). */
export const SCREEN_THEME = {
  surface: {
    panel: "bg-gray-900 border border-gray-800 rounded-lg",
    panelHeader: "bg-gradient-to-b from-gray-800/50 to-gray-900 px-4 py-3",
    divider: "border-gray-800",
    netWorthAccent: "bg-gradient-to-br from-blue-900/40 to-gray-900 border border-blue-800/50 shadow-[0_0_24px_rgba(59,130,246,0.15)]",
  },
  text: {
    primary: "text-gray-100",
    secondary: "text-gray-300",
    muted: "text-gray-400",
  },
  status: {
    up: "text-emerald-400 bg-emerald-950/50 border border-emerald-900",
    down: "text-rose-400 bg-rose-950/50 border border-rose-900",
    flat: "text-gray-300 bg-gray-800 border border-gray-700",
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
    muted: colorsLight.ink3,         // #767a86
  },
  status: {
    up: { bg: "#ecfdf5", fg: colorsLight.good, border: "#a7f3d0" },   // emerald tint
    down: { bg: "#fef2f2", fg: colorsLight.crit, border: "#fecaca" }, // rose tint
    flat: { bg: colorsLight.card2, fg: colorsLight.ink2, border: colorsLight.hair2 }, // neutral
  },
} as const;
