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
  // Cash-flow chart palette — matches the in-app Cash Flow chart's saturated
  // colors so PDF and screen tell the same visual story. Order matches the
  // stack render order in cashflow-chart-spec.ts:
  //   [Social Security, Salaries, Other Inflows, RMDs, Withdrawals]
  chartStack: ["#2563eb", "#16a34a", "#99f6e4", "#f97316", "#ef4444"],
  // Dark ink line for Total Expenses overlay — pops against light paper and
  // doesn't collide with the saturated withdrawals red.
  chartLine: "#1a1a1d",
} as const;

export type PresentationTheme = typeof PRESENTATION_THEME;
