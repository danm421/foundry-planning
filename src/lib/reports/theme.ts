// src/lib/reports/theme.ts
//
// Single source of truth for the Foundry reports design system. Both
// surfaces consume these tokens:
//
//   1. PDF render — `components/reports-pdf/theme.ts` re-exports from here
//      so `@react-pdf/renderer` widgets can pass inline color strings.
//   2. Screen render — `app/globals.css` mirrors these as
//      `--color-report-*` CSS variables under `@theme inline`, which
//      Tailwind v4 auto-promotes to utility classes
//      (`bg-report-paper`, `text-report-ink`, `border-report-hair`,
//      etc.). Widget JSX uses those classes, so the on-screen builder
//      canvas renders the same cream/light palette as the PDF, even
//      though the surrounding app shell is dark.
//
// **When you change values here, update `globals.css` to match.** The
// `globals.css` block is annotated with a back-reference comment.

export const REPORT_THEME = {
  colors: {
    // Surfaces
    paper: "#f6f3ec",
    card: "#ffffff",
    zebra: "#fbf8f0",

    // Ink (text)
    ink: "#1a1a1d",
    ink2: "#5a5a60",
    ink3: "#8a8a90",

    // Inverse — for dark-banded surfaces (running header band, table headers)
    inkDeep: "#1f1d1a",
    inkOnDark: "#f5efe1",

    // Hairlines
    hair: "#d8d2c4",

    // Brand + status (also used as KPI tile top-accent and chart palette)
    accent: "#b87f1f",
    good: "#2f6b4a",
    crit: "#a13a3a",
    steel: "#3b6ea3",
    plum: "#7a4ea3",

    // Tinted backgrounds for status callouts. Keep these visibly different
    // from `paper` so the callout reads as a distinct surface even on cream.
    accentTint: "#f4e6c8",
    goodTint: "#dfeae0",
    critTint: "#f0d9d3",
  },

  // Ordered chart palette — series colors cycle through this in order.
  // First color matches `accent` so the primary series reads on-brand.
  chartPalette: [
    "#b87f1f", // accent — primary series (income, current scenario)
    "#2f6b4a", // good — savings, social security, success
    "#3b6ea3", // steel — pensions, secondary series, comparison
    "#7a4ea3", // plum — withdrawals, alternates
    "#a13a3a", // crit — expenses, risk, deficit
    "#5a5a60", // ink2 — other, neutral fallback
  ] as const,

  // KPI tile top-accent rule — the color hints at the metric's category.
  // Keys mirror the optional `accentColor` widget prop. Default is `"accent"`.
  categoryColors: {
    accent: "#b87f1f",
    good: "#2f6b4a",
    crit: "#a13a3a",
    steel: "#3b6ea3",
  } as const,

  // Type role tokens. `pdfPx` values are points (1pt ≈ 1.333px) — they're
  // PDF-space sizes that `@react-pdf/renderer` consumes directly. `screenClass`
  // strings are Tailwind utility classes the screen widgets apply.
  type: {
    titleSection:    { pdfPx: 22, screenClass: "text-2xl font-medium",  family: "Fraunces" },
    titleSubsection: { pdfPx: 14, screenClass: "text-base font-medium", family: "Fraunces" },
    eyebrowSmall:    { pdfPx: 8,  screenClass: "text-[10px]",           family: "JetBrains Mono" },
    eyebrowSection:  { pdfPx: 9,  screenClass: "text-[11px]",           family: "JetBrains Mono" },
    valueKpi:        { pdfPx: 24, screenClass: "text-3xl font-medium",  family: "Inter" },
    labelKpi:        { pdfPx: 8,  screenClass: "text-[10px] uppercase tracking-wider font-medium", family: "JetBrains Mono" },
    body:            { pdfPx: 10, screenClass: "text-sm",               family: "Inter" },
    caption:         { pdfPx: 9,  screenClass: "text-xs",               family: "Inter" },
  } as const,

  // Spacing + rule tokens. Widths in PDF points; screen widgets use the
  // matching Tailwind classes inline.
  rules: {
    section:        { thickness: 2,   color: "#b87f1f", screenClass: "border-b-2 border-report-accent" },
    subsection:     { thickness: 1.5, color: "#b87f1f", screenClass: "border-b border-report-accent" },
    tile:           { thickness: 2,   /* color from categoryColors */     screenClass: "border-t-2" },
    hair:           { thickness: 1,   color: "#d8d2c4", screenClass: "border border-report-hair" },
    bandUnderline:  { thickness: 1.5, color: "#b87f1f", screenClass: "border-b border-report-accent" },
  } as const,

  radii: {
    card: 6,    // PDF px and screen rounded-md (6px)
  } as const,
} as const;

// Convenience flat color exports (used by Chart.js options + a few PDF widgets
// that don't want to deep-destructure REPORT_THEME).
export type ReportColor = keyof typeof REPORT_THEME.colors;
