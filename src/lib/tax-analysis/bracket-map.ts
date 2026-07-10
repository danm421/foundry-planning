import type { TaxYearParameters } from "@/lib/tax/types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { resolveLtcg } from "./adapter";

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

const n = (v: number | null | undefined): number => v ?? 0;

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
  const stackTop = taxBase + preferentialBase; // == ti when split extracted cleanly

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
