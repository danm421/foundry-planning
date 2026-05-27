// Framework-free theme tokens for the Presentations subsystem. Re-uses
// Foundry's existing PDF palette and adds three new tokens that subsequent
// pages will share.

export const PRESENTATION_THEME = {
  paper: "#f6f3ec",
  card: "#ffffff",
  ink: "#1a1a1d",
  ink2: "#5a5a60",
  ink3: "#8a8a90",
  hair: "#d8d2c4",
  accent: "#b87f1f",
  good: "#2f6b4a",
  crit: "#a13a3a",
  // New tokens added for the Presentations subsystem.
  steel: "#3b6ea3",
  accentMuted: "#d4a86a",
  accentTint: "#f4e6c8",
  // Resolved palettes — used by ChartSpec builder so adapters never look up
  // tokens themselves.
  chartStack: ["#3b6ea3", "#b87f1f", "#2f6b4a", "#d4a86a", "#5a5a60"],
  chartLine: "#a13a3a",
} as const;

export type PresentationTheme = typeof PRESENTATION_THEME;
