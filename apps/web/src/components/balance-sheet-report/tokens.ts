// src/components/balance-sheet-report/tokens.ts
//
// Shared design tokens for the balance sheet report. Used by both the
// on-screen view (via Tailwind classes) and the PDF document (via react-pdf
// StyleSheet) so the two can't drift apart.

export type AssetCategoryKey =
  | "cash"
  | "taxable"
  | "retirement"
  | "realEstate"
  | "business"
  | "lifeInsurance";

/** Human-readable category labels shown in the UI. */
export const CATEGORY_LABELS: Record<AssetCategoryKey, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  realEstate: "Real Estate",
  business: "Business",
  lifeInsurance: "Life Insurance",
};

/** Category order in the assets panel (left → top, right → bottom). */
export const CATEGORY_ORDER: AssetCategoryKey[] = [
  "cash",
  "taxable",
  "retirement",
  "realEstate",
  "business",
  "lifeInsurance",
];

/** Hex palette used by the donut chart (both themes) and PDF rendering. */
export const CATEGORY_HEX: Record<AssetCategoryKey, string> = {
  cash: "#10b981",        // emerald-500
  taxable: "#3b82f6",     // blue-500
  retirement: "#8b5cf6",  // violet-500
  realEstate: "#f59e0b",  // amber-500
  business: "#ec4899",    // pink-500
  lifeInsurance: "#14b8a6", // teal-500
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
    muted: "text-gray-500",
  },
  status: {
    up: "text-emerald-400 bg-emerald-950/50 border border-emerald-900",
    down: "text-rose-400 bg-rose-950/50 border border-rose-900",
    flat: "text-gray-400 bg-gray-800 border border-gray-700",
  },
} as const;

/** PDF theme (light, print-friendly). Raw hex values — react-pdf uses CSS-in-JS. */
export const PDF_THEME = {
  surface: {
    page: "#ffffff",
    panel: "#f8fafc",           // slate-50
    panelBorder: "#e2e8f0",     // slate-200
    panelHeader: "#f1f5f9",     // slate-100
    divider: "#e2e8f0",
    netWorthAccent: "#eff6ff",  // blue-50
    netWorthBorder: "#bfdbfe",  // blue-200
  },
  text: {
    primary: "#0f172a",   // slate-900
    secondary: "#334155", // slate-700
    muted: "#64748b",     // slate-500
  },
  status: {
    up: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },   // emerald
    down: { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" }, // rose
    flat: { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" }, // slate
  },
} as const;
