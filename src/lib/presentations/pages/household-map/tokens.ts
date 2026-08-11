// Print hex for the two Household Map colour scales.
//
// The boards paint these through the `--color-cat-*` custom properties, which
// @react-pdf/renderer cannot resolve — it takes literal colour strings. The
// values below are the LIGHT-mode definitions from `app/globals.css`
// (`:root[data-theme="light"]`), not the dark ones: a presentation renders on
// cream paper, and the dark-mode hues (#34d399 and friends) wash out on it.
//
// Keep in lock-step with globals.css. A drift here shows up as a card whose
// stripe means something different on paper than it does on screen.

import type { MapItem } from "@/lib/household-map/types";
import type { GoalKind } from "@/lib/household-map/goals";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";

/** `MapItem.category` → the card's left stripe. Mirrors `CATEGORY_BORDER` in
 *  `components/household-map/map-card.tsx`. `debt` is the app's error red,
 *  reserved for actual liabilities, exactly as it is on screen. */
export const MAP_CATEGORY_HEX: Record<MapItem["category"], string> = {
  investments: "#047857", // --color-cat-income
  property: "#1d4ed8", // --color-cat-portfolio
  debt: PRESENTATION_THEME.crit, // #b91c1c
  household: "#0e7490", // --color-cat-transactions
  insurance: "#be185d", // --color-cat-insurance
};

/** `GoalKind` → the spine card's accent border. Mirrors `KIND_STYLE` in
 *  `components/household-map/goals-board.tsx` — same hue per kind, so a goal
 *  the advisor recognises on the board is the same colour in the deck. */
export const MAP_GOAL_KIND_HEX: Record<GoalKind, string> = {
  education: "#1d4ed8", // --color-cat-portfolio
  purchase: PRESENTATION_THEME.crit,
  household: "#0e7490", // --color-cat-transactions
  retirement: "#047857", // --color-cat-income
  life_expectancy: "#6d28d9", // --color-cat-life
  social_security: "#d97706", // --color-cat-tax
};

/** The section label printed above each goal card, per kind. Mirrors the
 *  `label` half of `KIND_STYLE`. "Life expectancy", never "Plan end" — there
 *  are two of these cards and only the later one ends the plan. */
export const MAP_GOAL_KIND_LABEL: Record<GoalKind, string> = {
  education: "Education",
  purchase: "Purchase",
  household: "Household",
  retirement: "Retirement",
  life_expectancy: "Life expectancy",
  social_security: "Social Security",
};
