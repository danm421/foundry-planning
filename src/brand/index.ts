// =============================================================================
// FOUNDRY — TYPE-SAFE BRAND TOKENS
//
// Vendored mirror of the canonical brand kit
// (`~/Documents/brain/30-areas/foundry-brand/tokens/foundry-tokens.ts`).
// JS access to the same values `src/app/globals.css` exposes as CSS vars —
// import in any TS/TSX file (charts, PDF renderers, anywhere CSS vars can't reach):
//   import { colors, colorsLight, data, dataLight, type, fonts, accentWash, dataScale } from "@/brand"
//
// Authoritative for these values: `foundry-design` SKILL.md (v2.1 + the
// "Amendments since v2.1" section). Keep in lock-step with globals.css.
// =============================================================================

export const colors = {
  // Brand
  accent:      "#f59e0b",
  accentInk:   "#fbbf24",
  accentDeep:  "#b45309",
  accentOn:    "#1a1205",

  secondary:    "#6366f1",
  secondaryInk: "#818cf8",
  secondaryOn:  "#ffffff",

  // Surfaces
  paper:       "#0b0c0f",
  card:        "#15171f",
  card2:       "#1a1d27",
  cardHover:   "#1f2330",

  // Ink — high-contrast on near-black
  ink:         "#f4f5f7",
  ink2:        "#d4d7de",
  ink3:        "#aab0bc",
  ink4:        "#848a98",

  // Hairlines
  hair:        "#2b2f3a",
  hair2:       "#3a4051",

  // Status
  good:        "#4ade80",
  warn:        "#fbbf24",
  crit:        "#fb8d8d",

  // Category taxonomy
  cat: {
    income:       "#34d399",
    portfolio:    "#60a5fa",
    life:         "#a78bfa",
    tax:          "#f59e0b",
    insurance:    "#f472b6",
    transactions: "#22d3ee",
  },
} as const;

export const colorsLight = {
  accent:      "#d97706",
  accentInk:   "#b45309",
  accentDeep:  "#92400e",
  accentOn:    "#fffbeb",

  secondary:    "#4f46e5",
  secondaryInk: "#4338ca",
  secondaryOn:  "#ffffff",

  paper:       "#fefdf8",
  card:        "#faf8ef",
  card2:       "#f5f1e6",
  cardHover:   "#faf7ee",

  ink:         "#1a1d27",
  ink2:        "#474c59",
  ink3:        "#767a86",
  ink4:        "#a8abb3",

  hair:        "#e8e4d6",
  hair2:       "#d9d2bd",

  good:        "#047857",
  warn:        "#b45309",
  crit:        "#b91c1c",

  cat: {
    income:       "#047857",
    portfolio:    "#1d4ed8",
    life:         "#6d28d9",
    tax:          "#d97706",
    insurance:    "#be185d",
    transactions: "#0e7490",
  },
} as const;

// Deep Jewel data palette — six anchors (red·blue·green·yellow·grey·orange)
// plus three fills (purple·teal·pink). Rich, darker-toned; reads as one premium
// family. Lead charts with the anchors in order, add fills as series grow.
export const data = {
  red:    "#c0392b",
  blue:   "#2c5fa8",
  green:  "#2a8a5e",
  yellow: "#c99a1e",
  grey:   "#9ca3af",
  orange: "#cf6a1f",
  purple: "#6a3fa0",
  teal:   "#1f8a86",
  pink:   "#a83f6a",
} as const;

export const dataLight = {
  red:    "#c5392b",
  blue:   "#2d61aa",
  green:  "#1f8d5f",
  yellow: "#c2941b",
  grey:   "#878d99",
  orange: "#cf671d",
  purple: "#6c41a2",
  teal:   "#198b83",
  pink:   "#ab3f6b",
} as const;

/** A Deep Jewel data palette key — the stable identity used to color a series. */
export type DataColorKey = keyof typeof data;

// Accent-wash (active/selected backgrounds) per theme.
export const accentWash = {
  dark:  "rgba(245, 158, 11, 0.16)",
  light: "rgba(217, 119, 6, 0.16)",
} as const;

// Secondary-wash (indigo active/selected backgrounds) per theme.
export const secondaryWash = {
  dark:  "rgba(99, 102, 241, 0.16)",
  light: "rgba(79, 70, 229, 0.16)",
} as const;

// Deterministic categorical scale, in the Deep Jewel palette's perceptual band.
// Band per theme (OKLCH): dark L 0.78 · C 0.15, light L 0.58 · C 0.15.
// The accent-amber hue band (~55–85°) is reserved so data never reads as a CTA.
const DATA_BAND = { dark: { L: 0.78, C: 0.15 }, light: { L: 0.58, C: 0.15 } } as const;

export function dataScale(n: number, theme: "dark" | "light" = "dark"): string[] {
  const { L, C } = DATA_BAND[theme];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let h = (15 + (i * 360) / n) % 360; // even hue spacing, start ~red-orange
    if (h > 55 && h < 85) h = (h + 40) % 360; // reserve the accent-amber band
    out.push(`oklch(${L} ${C} ${h.toFixed(1)})`);
  }
  return out;
}

export const radii = { sm: 6, base: 10 } as const;

export const spacing = {
  padCard:  24,
  padCardY: 22,
  gapGrid:  16,
  rowH:     36,
} as const;

export const fonts = {
  sans: '"Inter", system-ui, -apple-system, sans-serif',
  mono: '"B612 Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const type = {
  display: { size: 72, weight: 800, ls: "-0.035em", lh: 1.04 },
  h1:      { size: 44, weight: 800, ls: "-0.035em", lh: 1.08 },
  h2:      { size: 32, weight: 600, ls: "-0.025em", lh: 1.15 },
  h3:      { size: 22, weight: 600, ls: "-0.015em", lh: 1.25 },
  bodyL:   { size: 17, weight: 400, ls: "-0.005em", lh: 1.55 },
  body:    { size: 14, weight: 400, ls: "0",        lh: 1.5  },
  caption: { size: 11, weight: 500, ls: "0.08em",   lh: 1.4, upper: true },
} as const;

export const motion = {
  fast:    150,
  base:    200,
  slow:    320,
  ease:    "cubic-bezier(0.32, 0.72, 0, 1)",
  easeIn:  "cubic-bezier(0.4, 0, 1, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
} as const;

export const shadow = {
  sm:  "0 1px 2px rgba(0,0,0,0.4)",
  md:  "0 4px 12px rgba(0,0,0,0.4)",
  lg:  "0 12px 32px rgba(0,0,0,0.5)",
  xl:  "0 24px 64px rgba(0,0,0,0.55)",
} as const;

export type BrandColor = keyof typeof colors;
