// src/components/reports-pdf/theme.ts
//
// PDF-side theme tokens. Mirrors (but does not reuse) the Tailwind tokens
// in the screen builder — `@react-pdf/renderer` consumes inline color
// strings, not CSS variables. Keep palettes in sync by hand when either
// side changes.

export const PDF_THEME = {
  paper: "#f6f3ec",
  ink: "#1a1a1d",
  ink2: "#5a5a60",
  ink3: "#8a8a90",
  hair: "#d8d2c4",
  accent: "#b87f1f",
  good: "#2f6b4a",
  crit: "#a13a3a",
  chart: ["#b87f1f", "#2f6b4a", "#3461a8", "#7a4ea3", "#a13a3a", "#5a5a60"],
} as const;
