import type { Finding, FindingContext } from "../types";
import { fmtUsd, fmtPct } from "../format";
import { computeMagi, irmaaTiersFor, nextIrmaaCliff } from "../irmaa-util";

export function bracketPosition(ctx: FindingContext): Finding | null {
  const map = ctx.bracketMap;
  if (!map) return null;
  const { marginalRate, headroomToNext, nextRate } = map.ordinary;
  const tail =
    headroomToNext != null && nextRate != null
      ? ` ${fmtUsd(headroomToNext)} of additional ordinary income would still be taxed at ${fmtPct(marginalRate)} before reaching the ${fmtPct(nextRate)} bracket.`
      : " You are in the top federal bracket.";
  return {
    id: "bracket-position",
    severity: "info",
    category: "brackets",
    headline: `Ordinary income tops out in the ${fmtPct(marginalRate)} bracket`,
    whatTheReturnShows: `Your ordinary taxable income of ${fmtUsd(map.ordinary.taxBase)} places you in the ${fmtPct(marginalRate)} federal bracket.` + tail,
    whyItMatters: "",
    whatToConsider: "",
    lineRefs: [],
    estimatedImpact: null,
    numbers: { marginalRate, taxBase: map.ordinary.taxBase, headroom: headroomToNext ?? 0 },
  };
}

export function rothHeadroom(ctx: FindingContext): Finding | null {
  const map = ctx.bracketMap;
  if (!map) return null;
  const { marginalRate, headroomToNext, nextRate } = map.ordinary;
  if (headroomToNext == null || nextRate == null || headroomToNext < 1000) return null;

  const numbers: Record<string, number> = { headroom: headroomToNext, rate: marginalRate };
  let caveat = "";
  const magi = computeMagi(ctx.facts);
  const tiers = magi != null ? irmaaTiersFor(ctx.facts, ctx.irmaaParams) : null;
  if (magi != null && tiers) {
    const cliff = nextIrmaaCliff(magi, tiers);
    if (cliff && cliff.distance < headroomToNext) {
      numbers.irmaaCliffDistance = cliff.distance;
      caveat = ` Note: a conversion above ${fmtUsd(cliff.distance)} would also cross an IRMAA threshold (see the Medicare observation below).`;
    }
  }
  return {
    id: "roth-headroom",
    severity: "opportunity",
    category: "retirement",
    headline: "Roth conversion headroom",
    whatTheReturnShows: `Based on this return, up to ${fmtUsd(headroomToNext)} could be converted from a traditional IRA to Roth while staying in the ${fmtPct(marginalRate)} bracket (the next dollar above that is taxed at ${fmtPct(nextRate)}).` + caveat,
    whyItMatters: "",
    whatToConsider: "",
    lineRefs: [],
    estimatedImpact: null,
    numbers,
  };
}

export function ltcgZeroHeadroom(ctx: FindingContext): Finding | null {
  const map = ctx.bracketMap;
  if (!map || map.capGains.zeroPctHeadroom < 500) return null;
  const room = map.capGains.zeroPctHeadroom;
  return {
    id: "ltcg-zero-headroom",
    severity: "opportunity",
    category: "investments",
    headline: "0% capital-gains bracket headroom",
    whatTheReturnShows: `Up to ${fmtUsd(room)} of additional long-term capital gains could be realized at a 0% federal rate this year — a tax-gain-harvesting opportunity to step up cost basis for free.`,
    whyItMatters: "",
    whatToConsider: "",
    lineRefs: [],
    estimatedImpact: null,
    numbers: { headroom: room },
  };
}
