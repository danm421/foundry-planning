import type { TaxYearParameters } from "@/lib/tax/types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { n, resolveLtcg } from "./adapter";

export interface BracketSegment {
  from: number;
  to: number | null;
  rate: number;
  /** Dollars of the ordinary tax base inside this segment. */
  filled: number;
}

export interface BracketMap {
  ordinary: {
    segments: BracketSegment[];
    taxBase: number; // taxable income minus preferential income
    marginalRate: number;
    headroomToNext: number | null; // null in the top bracket
    nextRate: number | null;
  };
  capGains: {
    zeroPctTop: number;
    fifteenPctTop: number;
    preferentialBase: number; // LTCG + qualified dividends
    ordinaryFloor: number; // preferential income stacks on top of this
    zeroPctHeadroom: number;
  };
}

export function buildBracketMap(
  facts: TaxReturnFacts,
  params: TaxYearParameters,
): BracketMap | null {
  const ti = facts.deductions.taxableIncome;
  const fs = facts.filingStatus;
  if (ti == null || fs == null) return null;

  // Schedule-D fallback rule lives in one place (adapter.ts) — resolveLtcg
  // returns the raw figure, which may be negative (a loss) or null.
  const ltcg = Math.max(0, resolveLtcg(facts) ?? 0);
  const preferentialBase = ltcg + n(facts.income.qualifiedDividends);
  const taxBase = Math.max(0, ti - preferentialBase);

  const tiers = params.incomeBrackets[fs];
  const segments: BracketSegment[] = tiers.map((t) => ({
    from: t.from,
    to: t.to,
    rate: t.rate,
    filled: Math.max(
      0,
      Math.min(taxBase, t.to ?? Number.POSITIVE_INFINITY) - t.from,
    ),
  }));

  const marginalIdx = tiers.findIndex(
    (t) => taxBase >= t.from && (t.to === null || taxBase < t.to),
  );
  const marginal = tiers[marginalIdx] ?? tiers[tiers.length - 1];
  const next = tiers[marginalIdx + 1] ?? null;

  const cg = params.capGainsBrackets[fs];
  // == ti when the split extracted cleanly. Capped at ti per the IRS Qualified
  // Dividends and Capital Gain Tax Worksheet: the stacked amount can never
  // exceed taxable income — when ti < preferentialBase (deductions consumed
  // the ordinary portion), the uncapped sum would overstate the stack top and
  // understate 0%-bracket headroom.
  const stackTop = Math.min(taxBase + preferentialBase, ti);

  return {
    ordinary: {
      segments,
      taxBase,
      marginalRate: marginal.rate,
      headroomToNext: marginal.to === null ? null : marginal.to - taxBase,
      nextRate: next?.rate ?? null,
    },
    capGains: {
      zeroPctTop: cg.zeroPctTop,
      fifteenPctTop: cg.fifteenPctTop,
      preferentialBase,
      ordinaryFloor: taxBase,
      zeroPctHeadroom: Math.max(0, cg.zeroPctTop - stackTop),
    },
  };
}

export interface BracketBarSegment {
  from: number;
  to: number | null;
  rate: number;
  /** 0-100: this segment's share of the bar's horizontal width. */
  widthPct: number;
  /** 0-100: how much of the segment's own width is "filled" (taxed). */
  fillPct: number;
}

export interface CapGainsBarLayout {
  /** 0-100: width of the ordinary-income floor portion. */
  floorPct: number;
  /** 0-100: left offset of the preferential-income fill. */
  fillLeftPct: number;
  /** 0-100: width of the preferential-income fill. */
  fillWidthPct: number;
  /** 0-100: left offset of the 0%-bracket-top dashed marker. */
  markerLeftPct: number;
}

export interface BracketBarLayout {
  segments: BracketBarSegment[];
  capGains: CapGainsBarLayout;
}

/** Pure layout geometry for the two bracket bars (ordinary-income segments +
 *  cap-gains stacking), shared by the screen (bracket-map-bars.tsx) and the
 *  PDF (tax-analysis-pdf-document.tsx) renderers — same visible-segment
 *  filter, scaleTop taxBase=0 guard, and cap-gains cgTop/cgPct math in one
 *  place instead of duplicated byte-for-byte across two components. */
export function computeBracketBarLayout(map: BracketMap): BracketBarLayout {
  const visible = map.ordinary.segments.filter(
    (s) => s.filled > 0 || s.from <= map.ordinary.taxBase * 1.6,
  );
  const lastVisible = visible[visible.length - 1];
  const scaleTop = Math.max(
    map.ordinary.taxBase * 1.25,
    lastVisible?.to ?? lastVisible?.from ?? 1,
    1,
  );

  const segments: BracketBarSegment[] = visible.map((seg) => {
    const widthPct = Math.max(
      0,
      ((Math.min(seg.to ?? scaleTop, scaleTop) - seg.from) / scaleTop) * 100,
    );
    const fillPct = seg.to
      ? Math.min(100, (seg.filled / (seg.to - seg.from)) * 100)
      : seg.filled > 0 ? 100 : 0;
    return { from: seg.from, to: seg.to, rate: seg.rate, widthPct, fillPct };
  });

  const cgTop = Math.max(
    map.capGains.fifteenPctTop * 0.4,
    map.capGains.ordinaryFloor + map.capGains.preferentialBase * 1.5,
    map.capGains.zeroPctTop * 1.2,
  );
  const cgPct = (v: number) => Math.min(100, (v / cgTop) * 100);

  return {
    segments,
    capGains: {
      floorPct: cgPct(map.capGains.ordinaryFloor),
      fillLeftPct: cgPct(map.capGains.ordinaryFloor),
      fillWidthPct: cgPct(map.capGains.preferentialBase),
      markerLeftPct: cgPct(map.capGains.zeroPctTop),
    },
  };
}
