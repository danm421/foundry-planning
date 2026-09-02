// Pure stacking geometry for the presentation bar chart. Positive segments
// stack up from the zero line; negative segments stack down from it,
// tracked separately so diverging series (e.g. Portfolio Activity) render
// correctly. For all-positive data this matches a single-cumulative stack.

import { scaleBand } from "d3-scale";
import type { ChartSpec } from "@/lib/presentations/charts/types";

/**
 * The band scale the bars are laid out on.
 *
 * Exported so a geometry guard can ask where a bar actually is without
 * restating the range or the padding. The x-axis and marker labels have to sit
 * on a bar centre, and a test that recomputed that centre from its own copy of
 * these numbers would go on passing after the chart's changed underneath it.
 */
export function bandScale(spec: ChartSpec) {
  return scaleBand<number>()
    .domain(spec.xAxis.domain)
    .range([0, spec.width - spec.margin.left - spec.margin.right])
    .padding(0.2);
}

export interface BarRect {
  y: number;       // top edge in pixel space
  height: number;
}

export function stackRects(
  yScale: (value: number) => number,
  values: number[],
): BarRect[] {
  let pos = 0;
  let neg = 0;
  return values.map((v) => {
    let y0: number;
    let y1: number;
    if (v >= 0) {
      y0 = yScale(pos);
      y1 = yScale(pos + v);
      pos += v;
    } else {
      y0 = yScale(neg);
      y1 = yScale(neg + v);
      neg += v;
    }
    return { y: Math.min(y0, y1), height: Math.abs(y0 - y1) };
  });
}

/**
 * Where the legend entries sit, relative to the legend's own origin.
 *
 * The pitch is derived from the room the chart actually has, not fixed. The
 * fixed 85pt pitch it replaces was sized for one canvas: on the 540pt chart the
 * sixth label ran off the right edge and printed "Total Exper", and on the
 * 500pt retirement cash-flow panel it vanished entirely, leaving a black line
 * in the legend with no name beside it. An @react-pdf `Svg` child placed past
 * the viewport is simply not drawn — no error, no clipping artefact — so this
 * has to be right by construction.
 *
 * Pure and exported so the fit is provable with nothing rendered; the component
 * reads these numbers rather than restating them.
 */
export const LEGEND_ROW_H = 11;
/** Marker width plus its gap — where each label starts inside its slot. */
export const LEGEND_LABEL_X = 14;
/** Marker, gap and the longest label the deck prints, at 7pt Inter. */
export const LEGEND_MIN_ITEM_W = 78;

export interface LegendLayout {
  perRow: number;
  itemW: number;
  rows: number;
}

export function legendLayout(count: number, availableW: number): LegendLayout {
  const fit = Math.floor(availableW / LEGEND_MIN_ITEM_W);
  const perRow = Math.max(1, Math.min(Math.max(count, 1), fit));
  return { perRow, itemW: availableW / perRow, rows: Math.ceil(Math.max(count, 1) / perRow) };
}

export function legendSlot(index: number, layout: LegendLayout): { x: number; y: number } {
  return {
    x: (index % layout.perRow) * layout.itemW,
    y: Math.floor(index / layout.perRow) * LEGEND_ROW_H,
  };
}

// ── Marker labels ────────────────────────────────────────────────────────────
/**
 * Where each timeline marker's label goes.
 *
 * A label centred on its own bar is right in isolation and wrong in a group.
 * On a couple's chart the two retirement markers are a year apart and the two
 * end-of-life markers likewise, so four labels ~80pt wide were drawn on centres
 * ~14pt apart, all on one baseline: a real client deck printed
 * "Matt NewnhaCarrie — Retirement" at the left and "Matt NewnhCarrie — End of
 * Lif" clipped off the right edge. Neither the overprint nor the clipping
 * raises anything — an @react-pdf `Svg` child past the viewport is simply not
 * drawn — so this has to be right by construction.
 *
 * Two rules, in this order:
 *  1. Clamp each label's box inside the canvas, so nothing is cut off. The
 *     dashed rule still stands on the bar, so a nudged label is still readable
 *     as belonging to it.
 *  2. Stack any label that would still overlap a neighbour onto the row above,
 *     within the room `margin.top` actually has.
 *
 * Pure and exported so the fit is provable with nothing rendered; the component
 * reads these numbers rather than restating them.
 */
/** 6pt Inter measures 2.86–3.32 pt/char across the names, dashes and phrases
 *  these labels carry. The TOP of that range is used deliberately: over-stating
 *  a width nudges a label further inside and stacks it sooner, while
 *  under-stating one puts it back off the canvas. */
export const MARKER_LABEL_PT_PER_CHAR = 3.35;
/** Baseline-to-baseline when labels stack, at 6pt. */
export const MARKER_LABEL_ROW_H = 7.5;
/** The first row sits just clear of the plot's top edge. */
export const MARKER_LABEL_BASE_Y = -4;
/** Clear air between two labels sharing a row. */
export const MARKER_LABEL_GAP = 3;

export interface MarkerLabelPlacement {
  /** Centre x, clamped so the whole label stays on the canvas. */
  x: number;
  /** Baseline y, in the plot's own coordinates (negative = above the plot). */
  y: number;
  /** Half the label's estimated width — the component needs no copy of the
   *  character metric to know what it drew. */
  halfWidth: number;
}

export function markerLabelWidth(label: string): number {
  return label.length * MARKER_LABEL_PT_PER_CHAR;
}

export function markerLabelLayout(
  markers: ReadonlyArray<{ label: string }>,
  centres: readonly number[],
  spec: Pick<ChartSpec, "width" | "margin">,
): MarkerLabelPlacement[] {
  // The canvas in the plot group's own coordinates: the group is translated by
  // margin.left, and an Svg child is drawn only within [0, width].
  const minX = -spec.margin.left;
  const maxX = spec.width - spec.margin.left;
  // Rows have to stay inside the top margin, or a stacked label is clipped by
  // the viewport exactly the way the overhanging one was.
  const maxRows = Math.max(1, Math.floor(spec.margin.top / MARKER_LABEL_ROW_H));

  const order = markers.map((_, i) => i).sort((a, b) => centres[a] - centres[b]);
  const rowEnds: number[] = []; // right edge of the last label placed in each row
  const out: MarkerLabelPlacement[] = new Array(markers.length);

  for (const i of order) {
    const halfWidth = markerLabelWidth(markers[i].label) / 2;
    const x = Math.min(Math.max(centres[i], minX + halfWidth), maxX - halfWidth);
    let row = rowEnds.findIndex((end) => x - halfWidth >= end + MARKER_LABEL_GAP);
    if (row === -1) row = rowEnds.length < maxRows ? rowEnds.length : 0;
    rowEnds[row] = x + halfWidth;
    out[i] = { x, y: MARKER_LABEL_BASE_Y - row * MARKER_LABEL_ROW_H, halfWidth };
  }
  return out;
}
