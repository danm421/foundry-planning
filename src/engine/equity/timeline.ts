import type { EquityGrant, EquityPlannedEvent, EquityVestTranche } from "./types";
import { resolveStrategy, type ResolvedStrategy } from "./strategy";
import { resolveStrikePrice } from "./price-model";
import { anniversaryIn, endOfYear, yearOf } from "./dates";

export type EquityActionKind = "seed_held" | "acquire_rsu" | "exercise" | "sell" | "expire";

export interface EquityAction {
  year: number;
  /** The calendar date this action happens on.
   *
   *  For an event the database RECORDS (a pre-plan acquisition with `acquiredOn`
   *  set) this is the real date. For an event the plan MODELS it is this
   *  module's stated convention: an exercise takes the vest date, or its
   *  anniversary in a later chosen year; a sale takes 31 December of the sell
   *  year; an unentered pre-plan acquisition takes the plan start date and is
   *  therefore held zero days.
   *
   *  `year` stays because the projection is annual and every strategy field in
   *  the database is a year integer. `date` is what the holding-period tests
   *  read. They agree — `yearOf(date) === year` — for every kind EXCEPT
   *  `seed_held`, which is MODELED in the first plan year but ACQUIRED earlier. */
  date: string;
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
  /** FMV per share at acquisition, for a `seed_held` action ONLY — the stored
   *  pre-plan fact `tax-events.ts` needs and cannot reach from the grant (it has
   *  the grant, not the tranche). Null on every other kind, and null when the
   *  advisor left the date blank, so a price can never half-apply. */
  priceAtAcquisition?: number | null;
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
  const vestYear = yearOf(tranche.vestDate);
  const want = ((): number | null => {
    switch (s.exerciseTiming) {
      case "at_vest":
        return vestYear;
      case "specific_year":
        return s.exerciseYear != null ? Math.max(s.exerciseYear, vestYear) : vestYear;
      case "year_before_expiration":
        return grant.expirationYear != null ? grant.expirationYear - 1 : vestYear;
      case "manual":
        return plannedExerciseYears.length ? Math.min(...plannedExerciseYears) : null;
    }
  })();
  // Vested, or vested before the plan began.
  if (want == null || want < Math.min(vestYear, planStartYear)) return null;
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
  /** The date a MODELED sale happens on: 31 December of the sell year, floored at
   *  the acquisition's own date. A plan that says "sell in 2030" names no day, and
   *  31 December is the most probable reading — it also stops the predecessor's
   *  whole-year rule from taxing a genuine 18-month hold as short-term.
   *
   *  The floor matters: without it a same-year sell would read as held from
   *  31 December back to a March acquisition, i.e. a NEGATIVE holding period. */
  const sellDate = (year: number): string => {
    const eoy = endOfYear(Math.max(year, acquisitionYear));
    return eoy > acq.date ? eoy : acq.date;
  };
  // Manual escape hatch: explicit planned sell events always win over the strategy.
  if (plannedSells.length > 0) {
    let remaining = heldShares;
    const out: EquityAction[] = [];
    for (const ps of [...plannedSells].sort((a, b) => a.year - b.year)) {
      const shares = Math.min(ROUND(ps.shares), remaining);
      if (shares <= 0) continue;
      const y = Math.max(ps.year, acquisitionYear);
      out.push({ ...base, year: y, date: sellDate(y), kind: "sell", shares });
      remaining = ROUND(remaining - shares);
    }
    return out;
  }
  switch (s.sellTiming) {
    case "hold":
      return [];
    case "immediately":
      return [{ ...base, year: acquisitionYear, date: sellDate(acquisitionYear), kind: "sell", shares: ROUND(heldShares) }];
    case "hold_then_sell_year": {
      const y = Math.max(s.sellYear ?? acquisitionYear, acquisitionYear);
      return [{ ...base, year: y, date: sellDate(y), kind: "sell", shares: ROUND(heldShares) }];
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
        out.push({ ...base, year: y, date: sellDate(y), kind: "sell", shares });
        remaining = ROUND(remaining - shares);
      }
      return out;
    }
  }
}

/** Allocate this grant's planned sells to one acquisition.
 *
 *  A grant-level planned event ("sell 1,000 shares in 2030", `trancheId` null)
 *  names a share count for the WHOLE GRANT. It used to be re-read inside the
 *  per-row loop, so a four-row grant sold 1,000 shares four times over — 4,000
 *  shares against a 4,000-share grant, the entire position. `budget` carries
 *  what is left of each such event across the grant, and every acquisition
 *  draws from it in year order, capped by what that acquisition actually holds.
 *  Audit F43/F48.
 *
 *  Percentage and share-less events stay per-row and are not budgeted: 25% of
 *  each row IS 25% of the grant, and "no shares, no pct" means "sell this row".
 */
function drawPlannedSells(
  events: { event: EquityPlannedEvent; key: number }[],
  budget: Map<number, number>,
  acquiredShares: number,
  trancheShares: number,
): { year: number; shares: number }[] {
  let capacity = acquiredShares;
  const out: { year: number; shares: number }[] = [];
  for (const { event, key } of [...events].sort((a, b) => a.event.year - b.event.year)) {
    const left = budget.get(key);
    if (left == null) {
      // Unbudgeted: a tranche-targeted event (it already names one row), or a
      // grant-level percentage / bare event. Same reading as before.
      out.push({
        year: event.year,
        shares: event.shares ?? (event.pct != null ? ROUND(trancheShares * event.pct) : trancheShares),
      });
      continue;
    }
    const take = ROUND(Math.min(left, capacity));
    if (take <= 0) continue;
    budget.set(key, ROUND(left - take));
    capacity = ROUND(capacity - take);
    out.push({ year: event.year, shares: take });
  }
  return out;
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
    const t0 = grant.tranches[0] ?? { id: `${grant.id}-83b`, vestDate: grant.grantDate, shares: grant.sharesGranted, sharesExercised: 0, sharesSold: 0, acquiredOn: null, priceAtAcquisition: null, strategy: null };
    const sold = grant.tranches.reduce((s, t) => s + t.sharesSold, 0);
    const held = ROUND(grant.sharesGranted - sold);
    const s = resolveStrategy(acct, grant.strategy, t0.strategy);
    if (yearOf(grant.grantDate) < planStartYear) {
      const seed: EquityAction = { year: planStartYear, date: t0.acquiredOn ?? `${planStartYear}-01-01`, kind: "seed_held", grantId: grant.id, trancheId: t0.id, lotId: seedLot(t0.id), shares: held, priceAtAcquisition: t0.acquiredOn ? t0.priceAtAcquisition : null };
      if (held > 0) out.push(seed);
      out.push(...sellActions(s, seed, []));
    } else {
      // An 83(b) election starts the holding period at GRANT, so that is the
      // acquisition date — not the vest date, which is the whole point of the
      // election.
      const acq: EquityAction = { year: yearOf(grant.grantDate), date: grant.grantDate, kind: "acquire_rsu", grantId: grant.id, trancheId: t0.id, lotId: acquireLot(t0.id), shares: ROUND(grant.sharesGranted) };
      out.push(acq, ...sellActions(s, acq, []));
    }
    return out;
  }

  // One budget per grant-level planned sell that names an explicit share
  // count, drawn down as the rows below consume it. See `drawPlannedSells`.
  const sellBudget = new Map<number, number>();
  grant.plannedEvents.forEach((p, i) => {
    if (p.action === "sell" && p.trancheId == null && p.shares != null) {
      sellBudget.set(i, ROUND(p.shares));
    }
  });

  for (const tranche of grant.tranches) {
    const s = resolveStrategy(acct, grant.strategy, tranche.strategy);
    const plannedExerciseYears = grant.plannedEvents.filter((p) => p.action === "exercise" && (p.trancheId == null || p.trancheId === tranche.id)).map((p) => p.year);
    const sellEvents = grant.plannedEvents
      .map((event, key) => ({ event, key }))
      .filter(({ event }) => event.action === "sell" && (event.trancheId == null || event.trancheId === tranche.id));

    // The stored pre-plan acquisition of THIS row. A blank date means the
    // advisor has not entered one, and the fallback is deliberately the plan
    // start date — held zero days, so short-term and never qualifying. The price
    // is gated on the date so a half-entered fact can never apply. Audit F1/F2.
    const seedDate = tranche.acquiredOn ?? `${planStartYear}-01-01`;
    const seedPrice = tranche.acquiredOn ? tranche.priceAtAcquisition : null;

    if (!isOption) {
      // RSU tranche: vest = acquisition.
      const remaining = ROUND(tranche.shares - tranche.sharesSold);
      if (yearOf(tranche.vestDate) < planStartYear) {
        const seed: EquityAction = { year: planStartYear, date: seedDate, kind: "seed_held", grantId: grant.id, trancheId: tranche.id, lotId: seedLot(tranche.id), shares: remaining, priceAtAcquisition: seedPrice };
        if (remaining > 0) out.push(seed);
        out.push(...sellActions(s, seed, drawPlannedSells(sellEvents, sellBudget, remaining, tranche.shares)));
      } else {
        const acq: EquityAction = { year: yearOf(tranche.vestDate), date: tranche.vestDate, kind: "acquire_rsu", grantId: grant.id, trancheId: tranche.id, lotId: acquireLot(tranche.id), shares: ROUND(tranche.shares) };
        out.push(acq, ...sellActions(s, acq, drawPlannedSells(sellEvents, sellBudget, acq.shares, tranche.shares)));
      }
      continue;
    }

    // Option tranche.
    const alreadyExercisedHeld = ROUND(tranche.sharesExercised - tranche.sharesSold);
    const unexercised = ROUND(tranche.shares - tranche.sharesExercised);

    // Seed already-exercised-and-held shares as of planStartYear.
    if (alreadyExercisedHeld > 0) {
      const seed: EquityAction = { year: planStartYear, date: seedDate, kind: "seed_held", grantId: grant.id, trancheId: tranche.id, lotId: seedLot(tranche.id), shares: alreadyExercisedHeld, priceAtAcquisition: seedPrice };
      out.push(seed, ...sellActions(s, seed, drawPlannedSells(sellEvents, sellBudget, alreadyExercisedHeld, tranche.shares)));
    }

    if (unexercised <= 0) continue;

    const eYear = exerciseYearFor(s, tranche, grant, planStartYear, plannedExerciseYears, fmvAt);
    const expYear = grant.expirationYear;

    if (eYear != null) {
      // A MODELED exercise: on the vest date when the plan exercises at vest,
      // else that date's anniversary in the year the strategy chose. The plan
      // names a year, never a day; the vest anniversary is the honest reading
      // and keeps the exercise on the same calendar footing as the vest it came
      // from.
      const exDate = eYear === yearOf(tranche.vestDate) ? tranche.vestDate : anniversaryIn(tranche.vestDate, eYear);
      const ex: EquityAction = { year: eYear, date: exDate, kind: "exercise", grantId: grant.id, trancheId: tranche.id, lotId: exerciseLot(tranche.id), shares: unexercised };
      out.push(ex, ...sellActions(s, ex, drawPlannedSells(sellEvents, sellBudget, unexercised, tranche.shares)));
    } else if (expYear != null) {
      // No lot is ever created for an expiry — lotId is set only because the
      // field is required. Note this year can precede planStartYear (an option
      // that lapsed before the plan): inert for the tax ledger, which never runs
      // that year, but load-bearing for the balance sheet, which drains the
      // grant on it.
      out.push({ year: expYear, date: endOfYear(expYear), kind: "expire", grantId: grant.id, trancheId: tranche.id, lotId: exerciseLot(tranche.id), shares: unexercised });
    }
  }

  return out;
}
