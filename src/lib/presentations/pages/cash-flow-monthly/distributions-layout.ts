// Where the Distributions sheet's chart prints. Page 1 is the year card then
// the chart, and the card's height is the plan's: a year with six accounts,
// three goals and a depleted banner is twice the height of a plain one. Left
// to react-pdf, a chart that no longer fits under the card is moved onto a new
// sheet — one the deck never counted, so every later page number in the deck
// would be off by one.
//
// So the layout is decided HERE, before rendering, from the card's own lines:
// the chart shrinks to the room the card leaves, and when even a short chart
// will not fit it gets a sheet of its own. The renderer and
// `estimateMonthlyCashFlowPageCount` both read the decision, so the count is
// right by construction. The card height is an UPPER bound (a generous width
// per character, every wrapped line counted), so "fits" is never optimistic.
// Measured against real renders in page-count.test.tsx.
import { distributionCardLines } from "@/lib/solver/distribution-card-lines";
import type { DistributionRow } from "@/lib/solver/monthly-distributions";

/** Page 1's room under its section head, to the footer band: 720pt (792pt
 *  LETTER less the frame's 72pt bottom padding) less the head's foot at
 *  ~122.5pt, rounded down. */
const PAGE_ONE_ROOM = 595;
/** The chart's default height (the deck's drill chart). */
export const DISTRIBUTIONS_CHART_HEIGHT = 260;
/** Below this the plot is too short to read (80pt of it is axis and legend). */
const MIN_CHART_HEIGHT = 180;
/** A note under the chart: its 6pt margin plus 7pt lines at line height 1.35. */
const CHART_NOTE_MARGIN = 6;
const CHART_NOTE_LINE = 9.5;

// Heights, in points, of the card's parts as distributions-pdf.tsx styles them.
const CARD_CHROME = 2 + 16 + 17.2 + 8; // border, padding, year/age head, margin below
const BOX_CHROME = 1.5 + 8; // 0.75pt border and 4pt padding, top and bottom
const EYEBROW = 8.8;
const HERO = 21.6;
const RULE = 6.5;
const ROW = 11.6; // 8pt line + 1pt padding above and below
const ROW_EXTRA_LINE = 9.6;
const SUB_LINE = 9.1; // 7pt at line height 1.3
const BOX_GAP = 5;
const BANNER_CHROME = 2 + 6 + 5; // border, padding, margin below
const BANNER_LINE = 9;

// Characters per line, deliberately few (≈4.4pt a character at 8pt, 3.9 at
// 7pt, against measured averages nearer 4.0 and 3.4): a wrap counted that
// never happens only shrinks the chart a little.
const ROW_CHARS = 45; // a label beside its amount in a half-width box
const ROW_CHARS_INDENTED = 43;
const SUB_CHARS = 60; // a 7pt caption across a half-width box
const BANNER_CHARS = 120; // across the whole card, and a note under the chart

const lines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));
const row = (text: string, perLine = ROW_CHARS) => ROW + (lines(text, perLine) - 1) * ROW_EXTRA_LINE;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** The printed year card's height, in points — an upper bound. */
export function distributionsCardHeight(r: DistributionRow): number {
  const card = distributionCardLines(r);

  const needBox =
    BOX_CHROME +
    EYEBROW +
    HERO +
    SUB_LINE +
    RULE +
    sum(card.needLines.map((l) => row(l.label, ROW_CHARS_INDENTED))) +
    RULE +
    row([card.coveredByIncome.label, card.coveredByIncome.sources].filter(Boolean).join(" ")) +
    ROW;
  const taxesBox = BOX_CHROME + ROW + SUB_LINE;
  const left = needBox + BOX_GAP + taxesBox;

  const totalBox =
    BOX_CHROME +
    EYEBROW +
    HERO +
    lines(card.madeOfText, SUB_CHARS) * SUB_LINE +
    (card.unexplained != null ? ROW : 0) +
    RULE +
    sum(card.accounts.map((a) => row(a.note ? `${a.name} ${a.note}` : a.name))) +
    sum(card.qcdNotes.map((n) => 2 + lines(n, SUB_CHARS) * SUB_LINE));
  const goalsBox =
    card.goals.length === 0
      ? 0
      : BOX_GAP +
        BOX_CHROME +
        EYEBROW +
        lines(card.goalsCaption, SUB_CHARS) * SUB_LINE +
        2 +
        sum(
          card.goals.map(
            (g) =>
              row(g.from ? `${g.name} ${g.from}` : g.name) +
              (g.fromGeneral ? row(g.fromGeneral.label, ROW_CHARS_INDENTED) : 0) +
              (g.shortBy ? ROW : 0),
          ),
        );
  const right = totalBox + goalsBox;

  return (
    CARD_CHROME +
    (card.depletedBanner ? BANNER_CHROME + lines(card.depletedBanner, BANNER_CHARS) * BANNER_LINE : 0) +
    (card.lifeInsuranceNote ? 4 + lines(card.lifeInsuranceNote, BANNER_CHARS) * SUB_LINE : 0) +
    Math.max(left, right)
  );
}

export interface DistributionsChartPlacement {
  /** The chart's height: the default, or less when the card leaves less. */
  height: number;
  /** The card leaves too little room: the chart prints on a sheet of its own,
   *  at the default height, between the card and the table. */
  ownSheet: boolean;
}

/** Where the chart prints, given the year card above it (null: no card) and
 *  the notes printed under the chart. */
export function distributionsChartPlacement(
  summary: DistributionRow | null,
  chartNotes: string[],
): DistributionsChartPlacement {
  const notes = sum(chartNotes.map((n) => CHART_NOTE_MARGIN + lines(n, BANNER_CHARS) * CHART_NOTE_LINE));
  const room = PAGE_ONE_ROOM - (summary ? distributionsCardHeight(summary) : 0) - notes;
  if (room >= MIN_CHART_HEIGHT) {
    return { height: Math.min(DISTRIBUTIONS_CHART_HEIGHT, Math.floor(room)), ownSheet: false };
  }
  return { height: DISTRIBUTIONS_CHART_HEIGHT, ownSheet: true };
}
