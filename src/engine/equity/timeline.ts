import type { EquityGrant, EquityVestTranche } from "./types";
import { resolveStrategy, type ResolvedStrategy } from "./strategy";

export type EquityActionKind = "seed_held" | "acquire_rsu" | "exercise" | "sell" | "expire";

export interface EquityAction {
  year: number;
  kind: EquityActionKind;
  grantId: string;
  trancheId: string;
  shares: number;
}

const SELL_HORIZON = 60; // cap percent_per_year expansion (years)
const ROUND = (n: number) => Math.round(n * 1e6) / 1e6;

/** Decide the exercise year for an option tranche, or null if it should expire unexercised. */
function exerciseYearFor(
  s: ResolvedStrategy,
  tranche: EquityVestTranche,
  grant: EquityGrant,
  plannedExerciseYears: number[],
): number | null {
  switch (s.exerciseTiming) {
    case "at_vest":
      return tranche.vestYear;
    case "specific_year":
      return s.exerciseYear != null ? Math.max(s.exerciseYear, tranche.vestYear) : tranche.vestYear;
    case "year_before_expiration":
      return grant.expirationYear != null ? grant.expirationYear - 1 : tranche.vestYear;
    case "manual":
      return plannedExerciseYears.length ? Math.min(...plannedExerciseYears) : null;
  }
}

/** Expand a held position into dated sell actions per the sell strategy. */
function sellActions(
  s: ResolvedStrategy,
  grant: EquityGrant,
  tranche: EquityVestTranche,
  heldShares: number,
  acquisitionYear: number,
  plannedSells: { year: number; shares: number }[],
): EquityAction[] {
  const base = { grantId: grant.id, trancheId: tranche.id } as const;
  if (heldShares <= 0) return [];
  // Manual escape hatch: explicit planned sell events always win over the strategy.
  if (plannedSells.length > 0) {
    let remaining = heldShares;
    const out: EquityAction[] = [];
    for (const ps of [...plannedSells].sort((a, b) => a.year - b.year)) {
      const shares = Math.min(ROUND(ps.shares), remaining);
      if (shares <= 0) continue;
      out.push({ ...base, year: Math.max(ps.year, acquisitionYear), kind: "sell", shares });
      remaining = ROUND(remaining - shares);
    }
    return out;
  }
  switch (s.sellTiming) {
    case "hold":
      return [];
    case "immediately":
      return [{ ...base, year: acquisitionYear, kind: "sell", shares: ROUND(heldShares) }];
    case "hold_then_sell_year": {
      const y = s.sellYear ?? acquisitionYear;
      return [{ ...base, year: Math.max(y, acquisitionYear), kind: "sell", shares: ROUND(heldShares) }];
    }
    case "percent_per_year": {
      const pct = s.sellPercentPerYear ?? 0;
      const start = Math.max(s.sellStartYear ?? acquisitionYear, acquisitionYear);
      if (pct <= 0) return [];
      const out: EquityAction[] = [];
      let remaining = heldShares;
      for (let y = start; y < start + SELL_HORIZON && remaining > 1e-6; y++) {
        const shares = y >= start + SELL_HORIZON - 1 ? remaining : ROUND(remaining * pct);
        if (shares <= 0) break;
        out.push({ ...base, year: y, kind: "sell", shares });
        remaining = ROUND(remaining - shares);
      }
      return out;
    }
  }
}

/** Build the full price-free action timeline for one grant. */
export function buildGrantTimeline(
  grant: EquityGrant,
  accountStrategy: ResolvedStrategy | import("./types").EquityStrategy,
  planStartYear: number,
): EquityAction[] {
  const acct = "exerciseTiming" in accountStrategy && accountStrategy.exerciseTiming
    ? (accountStrategy as ResolvedStrategy)
    : resolveStrategy(accountStrategy as import("./types").EquityStrategy, null, null);
  const out: EquityAction[] = [];
  const isOption = grant.grantType !== "rsu";

  // 83(b) RSU: whole grant acquired at grant year, no per-tranche acquire.
  if (grant.grantType === "rsu" && grant.has83bElection) {
    const t0 = grant.tranches[0] ?? { id: `${grant.id}-83b`, vestYear: grant.grantYear, shares: grant.sharesGranted, sharesExercised: 0, sharesSold: 0, strategy: null };
    const sold = grant.tranches.reduce((s, t) => s + t.sharesSold, 0);
    const held = ROUND(grant.sharesGranted - sold);
    const s = resolveStrategy(acct, grant.strategy, t0.strategy);
    if (grant.grantYear < planStartYear) {
      if (held > 0) out.push({ year: planStartYear, kind: "seed_held", grantId: grant.id, trancheId: t0.id, shares: held });
      out.push(...sellActions(s, grant, t0, held, planStartYear, []));
    } else {
      out.push({ year: grant.grantYear, kind: "acquire_rsu", grantId: grant.id, trancheId: t0.id, shares: ROUND(grant.sharesGranted) });
      out.push(...sellActions(s, grant, t0, ROUND(grant.sharesGranted), grant.grantYear, []));
    }
    return out;
  }

  for (const tranche of grant.tranches) {
    const s = resolveStrategy(acct, grant.strategy, tranche.strategy);
    const plannedExerciseYears = grant.plannedEvents.filter((p) => p.action === "exercise" && (p.trancheId == null || p.trancheId === tranche.id)).map((p) => p.year);
    const plannedSells = grant.plannedEvents
      .filter((p) => p.action === "sell" && (p.trancheId == null || p.trancheId === tranche.id))
      .map((p) => ({ year: p.year, shares: p.shares ?? (p.pct != null ? ROUND(tranche.shares * p.pct) : tranche.shares) }));

    if (!isOption) {
      // RSU tranche: vest = acquisition.
      const remaining = ROUND(tranche.shares - tranche.sharesSold);
      if (tranche.vestYear < planStartYear) {
        if (remaining > 0) out.push({ year: planStartYear, kind: "seed_held", grantId: grant.id, trancheId: tranche.id, shares: remaining });
        out.push(...sellActions(s, grant, tranche, remaining, planStartYear, plannedSells));
      } else {
        out.push({ year: tranche.vestYear, kind: "acquire_rsu", grantId: grant.id, trancheId: tranche.id, shares: ROUND(tranche.shares) });
        out.push(...sellActions(s, grant, tranche, ROUND(tranche.shares), tranche.vestYear, plannedSells));
      }
      continue;
    }

    // Option tranche.
    const alreadyExercisedHeld = ROUND(tranche.sharesExercised - tranche.sharesSold);
    const unexercised = ROUND(tranche.shares - tranche.sharesExercised);

    // Seed already-exercised-and-held shares as of planStartYear.
    if (alreadyExercisedHeld > 0) {
      out.push({ year: planStartYear, kind: "seed_held", grantId: grant.id, trancheId: tranche.id, shares: alreadyExercisedHeld });
      out.push(...sellActions(s, grant, tranche, alreadyExercisedHeld, planStartYear, plannedSells));
    }

    if (unexercised <= 0) continue;

    const exYear = exerciseYearFor(s, tranche, grant, plannedExerciseYears);
    const expYear = grant.expirationYear;
    const exercisable = exYear != null && (expYear == null || exYear <= expYear) && exYear >= Math.min(tranche.vestYear, planStartYear);

    if (exercisable && exYear != null) {
      const eYear = Math.max(exYear, planStartYear);
      out.push({ year: eYear, kind: "exercise", grantId: grant.id, trancheId: tranche.id, shares: unexercised });
      out.push(...sellActions(s, grant, tranche, unexercised, eYear, plannedSells));
    } else if (expYear != null) {
      out.push({ year: expYear, kind: "expire", grantId: grant.id, trancheId: tranche.id, shares: unexercised });
    }
  }

  return out;
}
