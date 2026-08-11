// Page data for the three Household Map presentation pages.
//
// Every figure is pre-formatted or pre-summed here so the PDF renderers stay
// dumb: a renderer that re-derived a subtotal would be a second place for the
// deck and the on-screen board to disagree.

import type { MapItem } from "@/lib/household-map/types";
import type { GoalSide } from "@/lib/household-map/goals";

// No per-instance configuration on any of the three — the only control is the
// shared scenario picker (supportsScenarioOverride). Empty object keeps the
// registry plumbing uniform, matching Client Profile.
export type HouseholdMapPageOptions = Record<string, never>;
export const HOUSEHOLD_MAP_PAGE_OPTIONS_DEFAULT: HouseholdMapPageOptions = {};

/** One ownership column of the Net Worth board, or one owner column inside a
 *  Cash Flow band. `cards` is already filtered to that column. */
export interface MapColumnBlock {
  key: "client" | "joint" | "spouse";
  label: string;
  cards: MapItem[];
  /** Signed sum of `cards`. Net Worth only — a Cash Flow column subtotal would
   *  invite reading down a band, which is not what the board totals. */
  subtotalLabel: string | null;
}

/** The tray both board pages carry: anything owned by a trust, business, or a
 *  family member other than the two principals. */
export interface MapTrayBlock {
  label: string;
  cards: MapItem[];
}

export interface MapNetWorthPageData {
  title: string;
  /** The scenario this page renders. */
  subtitle: string;
  /** Column headers plus each principal's age, drawn as the board's person
   *  nodes. Empty for a household with no parsed DOBs. */
  personLine: string;
  columns: MapColumnBlock[];
  tray: MapTrayBlock | null;
  /**
   * NOT labelled "Net Worth", for the same reason the board's own chip isn't:
   * this is every account minus every liability, while `/details/net-worth`
   * reports a deliberately narrower number (no entity-owned accounts, no 529s,
   * no zero-value term policies). The label says what the figure is.
   */
  totalLabel: string;
  totalValueLabel: string;
}

export interface MapCashFlowBand {
  key: "income" | "savings" | "expense";
  label: string;
  columns: MapColumnBlock[];
  tray: MapTrayBlock | null;
  /**
   * Signed band total across columns AND tray, per `MapItem.value` — or null
   * when the band holds a card whose dollars this page cannot know (see
   * `MapCashFlowPageData.unresolvedNote`). Null, not "$0": a Savings band
   * printing "$0" over two cards reading "IRS max" and "10% of pay" states
   * something false, and print has no hover to correct it.
   */
  subtotalLabel: string | null;
}

export interface MapCashFlowPageData {
  title: string;
  subtitle: string;
  personLine: string;
  bands: MapCashFlowBand[];
  /**
   * The three band subtotals added up. Spelled out rather than called "net cash
   * flow": the Cash Flow report already owns that term for a projected,
   * tax-aware figure, and this is the arithmetic of the cards on this page.
   */
  netLabel: string;
  /** Null whenever `unresolvedNote` is set — the arithmetic is missing a term. */
  netValueLabel: string | null;
  /**
   * Set when the plan saves by RULE — "IRS max", "10% of pay", a custom
   * schedule. Those cards carry a real contribution the projection resolves and
   * a literal `0` here (`MapItem.editableAmount` is null for exactly this set),
   * so any total containing them understates savings and overstates what is
   * left over. The on-screen board can show "$0" because an advisor reads the
   * rule on the card beside it; a page handed to a client cannot. Null when
   * every savings card is a flat dollar amount.
   */
  unresolvedNote: string | null;
}

export interface MapGoalRow {
  id: string;
  year: number;
  /** "62 / 60" — both principals' ages in that year, or one age when solo. */
  agesLabel: string;
  side: GoalSide;
  kindLabel: string;
  accentHex: string;
  title: string;
  /** "for Kelly", or null. */
  forLabel: string | null;
  detail: string | null;
}

export interface MapGoalsPageData {
  title: string;
  subtitle: string;
  /** Column headers over the spine. `spouse` is null for a solo household, and
   *  the renderer then centres the spine's cards. */
  clientName: string;
  spouseName: string | null;
  rows: MapGoalRow[];
  /** Shown in place of the spine when the household has no expense-backed
   *  goals. Null when it has at least one. */
  emptyNote: string | null;
}
