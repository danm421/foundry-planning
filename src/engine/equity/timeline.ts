import type { EquityGrant, EquityVestTranche } from "./types";
import { resolveStrategy, type ResolvedStrategy } from "./strategy";
import { resolveStrikePrice } from "./price-model";

export type EquityActionKind = "seed_held" | "acquire_rsu" | "exercise" | "sell" | "expire";

export interface EquityAction {
  year: number;
  kind: EquityActionKind;
  grantId: string;
  trancheId: string;
  /** Identifies the ACQUISITION EVENT these shares belong to, not the vesting
   *  row. One row can hold two lots at once — shares exercised before the plan
   *  began and shares the plan exercises later — with different bases and
   *  different holding periods. A sell carries the lot id of the acquisition it
   *  came from. Unique within a grant. */
  lotId: string;
  shares: number;
}

/** Lot ids for the (at most) two acquisition events a vesting row can produce. */
const seedLot = (trancheId: string) => `${trancheId}#seed`;
const acquireLot = (trancheId: string) => `${trancheId}#acq`;
const exerciseLot = (trancheId: string) => `${trancheId}#ex`;

const SELL_HORIZON = 60; // cap percent_per_year expansion (years)
const ROUND = (n: number) => Math.round(n * 1e6) / 1e6;

/** The year the plan actually exercises this option tranche, or null if it never
 *  should and the shares just lapse.
 *
 *  A pre-plan exercise year is modeled in the first plan year, and expiry and
 *  moneyness are tested against THAT year rather than the year the strategy
 *  asked for — testing expiry against the original year let an option that
 *  lapsed in 2025 be "exercised" in 2026, booking W-2 income and a strike
 *  payment on something already worthless. The vest test deliberately stays on
 *  the requested year, so a tranche vesting after the plan can still be ruled
 *  out. */
function exerciseYearFor(
  s: ResolvedStrategy,
  tranche: EquityVestTranche,
  grant: EquityGrant,
  planStartYear: number,
  plannedExerciseYears: number[],
  fmvAt: (year: number) => number,
): number | null {
  const want = ((): number | null => {
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
  })();
  // Vested, or vested before the plan began.
  if (want == null || want < Math.min(tranche.vestYear, planStartYear)) return null;
  const year = Math.max(want, planStartYear);
  // Still alive in the year it would actually be exercised.
  if (grant.expirationYear != null && year > grant.expirationYear) return null;
  // In the money. Nobody pays $100 of strike for a $50 share.
  const fmv = fmvAt(year);
  if (fmv <= resolveStrikePrice(grant, fmv)) return null;
  return year;
}

/** Expand an acquisition into dated sell actions per the sell strategy. Takes
 *  the acquisition action itself, so every sell inherits its grant, row and lot
 *  id — the shares being sold are exactly the shares that arrived. */
function sellActions(
  s: ResolvedStrategy,
  acq: EquityAction,
  plannedSells: { year: number; shares: number }[],
): EquityAction[] {
  const heldShares = acq.shares;
  const acquisitionYear = acq.year;
  const base = { grantId: acq.grantId, trancheId: acq.trancheId, lotId: acq.lotId } as const;
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

/** Build the full action timeline for one grant.
 *
 *  `fmvAt` supplies the projected share price for a given year, so an option
 *  that is out of the money is not exercised. The moneyness decision has to
 *  live HERE: the balance sheet and the tax ledger both read this timeline, so
 *  an exercise skipped in one and kept in the other would lose the shares. */
export function buildGrantTimeline(
  grant: EquityGrant,
  accountStrategy: ResolvedStrategy | import("./types").EquityStrategy,
  planStartYear: number,
  fmvAt: (year: number) => number,
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
      const seed: EquityAction = { year: planStartYear, kind: "seed_held", grantId: grant.id, trancheId: t0.id, lotId: seedLot(t0.id), shares: held };
      if (held > 0) out.push(seed);
      out.push(...sellActions(s, seed, []));
    } else {
      const acq: EquityAction = { year: grant.grantYear, kind: "acquire_rsu", grantId: grant.id, trancheId: t0.id, lotId: acquireLot(t0.id), shares: ROUND(grant.sharesGranted) };
      out.push(acq, ...sellActions(s, acq, []));
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
        const seed: EquityAction = { year: planStartYear, kind: "seed_held", grantId: grant.id, trancheId: tranche.id, lotId: seedLot(tranche.id), shares: remaining };
        if (remaining > 0) out.push(seed);
        out.push(...sellActions(s, seed, plannedSells));
      } else {
        const acq: EquityAction = { year: tranche.vestYear, kind: "acquire_rsu", grantId: grant.id, trancheId: tranche.id, lotId: acquireLot(tranche.id), shares: ROUND(tranche.shares) };
        out.push(acq, ...sellActions(s, acq, plannedSells));
      }
      continue;
    }

    // Option tranche.
    const alreadyExercisedHeld = ROUND(tranche.sharesExercised - tranche.sharesSold);
    const unexercised = ROUND(tranche.shares - tranche.sharesExercised);

    // Seed already-exercised-and-held shares as of planStartYear.
    if (alreadyExercisedHeld > 0) {
      const seed: EquityAction = { year: planStartYear, kind: "seed_held", grantId: grant.id, trancheId: tranche.id, lotId: seedLot(tranche.id), shares: alreadyExercisedHeld };
      out.push(seed, ...sellActions(s, seed, plannedSells));
    }

    if (unexercised <= 0) continue;

    const eYear = exerciseYearFor(s, tranche, grant, planStartYear, plannedExerciseYears, fmvAt);
    const expYear = grant.expirationYear;

    if (eYear != null) {
      const ex: EquityAction = { year: eYear, kind: "exercise", grantId: grant.id, trancheId: tranche.id, lotId: exerciseLot(tranche.id), shares: unexercised };
      out.push(ex, ...sellActions(s, ex, plannedSells));
    } else if (expYear != null) {
      // No lot is ever created for an expiry — lotId is set only because the
      // field is required. Note this year can precede planStartYear (an option
      // that lapsed before the plan): inert for the tax ledger, which never runs
      // that year, but load-bearing for the balance sheet, which drains the
      // grant on it.
      out.push({ year: expYear, kind: "expire", grantId: grant.id, trancheId: tranche.id, lotId: exerciseLot(tranche.id), shares: unexercised });
    }
  }

  return out;
}
