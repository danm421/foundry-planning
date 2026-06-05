import type { StockOptionPlan, EquityGrant, GrantType } from "./types";
import { resolveStrategy } from "./strategy";
import { buildGrantTimeline, type EquityAction } from "./timeline";
import { projectFmv, resolveStrikePrice } from "./price-model";

/** One acquired-and-held lot (per tranche). */
interface Lot {
  grantId: string;
  trancheId: string;
  grantType: GrantType;
  shares: number;
  basisPerShare: number;   // regular-tax basis (ISO = strike; RSU/NQSO = FMV at acquire)
  acquisitionYear: number;
  grantYear: number;
  exerciseYear: number | null;   // options only
  strike: number;                // options only (for disqualifying bargain element)
  fmvAtExercise: number;         // options only
}

export interface EquityState {
  planStartYear: number;
  actionsByYear: Map<string, Map<number, EquityAction[]>>; // accountId → year → actions
  lots: Map<string, Lot>;        // key = `${grantId}:${trancheId}`
  grantsById: Map<string, EquityGrant>;
}

export interface EquityYearResult {
  ordinaryIncome: number;   // W-2 wages (FICA-bearing)
  isoSpread: number;        // AMT preference
  capitalGains: number;     // long-term
  stCapitalGains: number;   // short-term
  strikeCashOutflow: number;
  sellProceeds: number;
  sellToCoverProceeds: number;
  acquisitions: { value: number; basis: number }[]; // in-kind inflows to the destination account
  saleBasisRemoved: number; // basis to drain from destination account on sells
}

const ROUND = (n: number) => Math.round(n * 1e6) / 1e6;
const lotKey = (a: { grantId: string; trancheId: string }) => `${a.grantId}:${a.trancheId}`;

export function createEquityState(plans: StockOptionPlan[], planStartYear: number): EquityState {
  const actionsByYear = new Map<string, Map<number, EquityAction[]>>();
  const grantsById = new Map<string, EquityGrant>();
  for (const p of plans) {
    const acctStrategy = resolveStrategy(p.strategy, null, null);
    const byYear = new Map<number, EquityAction[]>();
    for (const g of p.grants) {
      grantsById.set(g.id, g);
      for (const a of buildGrantTimeline(g, acctStrategy, planStartYear)) {
        (byYear.get(a.year) ?? byYear.set(a.year, []).get(a.year)!).push(a);
      }
    }
    actionsByYear.set(p.accountId, byYear);
  }
  return { planStartYear, actionsByYear, lots: new Map(), grantsById };
}

function emptyResult(): EquityYearResult {
  return { ordinaryIncome: 0, isoSpread: 0, capitalGains: 0, stCapitalGains: 0, strikeCashOutflow: 0, sellProceeds: 0, sellToCoverProceeds: 0, acquisitions: [], saleBasisRemoved: 0 };
}

export function computeEquityYear(plan: StockOptionPlan, state: EquityState, year: number): EquityYearResult {
  const res = emptyResult();
  const actions = state.actionsByYear.get(plan.accountId)?.get(year) ?? [];
  const fmv = (y: number) => projectFmv(plan.pricePerShare, plan.growthRate, y, state.planStartYear);

  // Process acquisitions/exercises BEFORE sells in the same year (cashless/sell-to-cover).
  const order: Record<string, number> = { seed_held: 0, acquire_rsu: 1, exercise: 2, sell: 3, expire: 4 };
  const sorted = [...actions].sort((a, b) => order[a.kind] - order[b.kind]);

  for (const a of sorted) {
    const grant = state.grantsById.get(a.grantId)!;
    const key = lotKey(a);

    if (a.kind === "seed_held") {
      // Already vested/exercised before the plan. Basis stepped to today (pre-plan gain
      // was already taxed as W-2). ISO held lots keep strike basis when known.
      const basisPerShare = grant.grantType === "iso" && grant.strikePrice != null ? grant.strikePrice : fmv(year);
      state.lots.set(key, {
        grantId: a.grantId, trancheId: a.trancheId, grantType: grant.grantType, shares: a.shares,
        basisPerShare, acquisitionYear: state.planStartYear - 2, grantYear: grant.grantYear,
        exerciseYear: grant.grantType === "rsu" ? null : state.planStartYear - 2,
        strike: grant.strikePrice ?? 0, fmvAtExercise: basisPerShare,
      });
      res.acquisitions.push({ value: ROUND(a.shares * fmv(year)), basis: ROUND(a.shares * basisPerShare) });
      continue;
    }

    if (a.kind === "acquire_rsu") {
      const f = grant.has83bElection ? (grant.fmvAtGrant ?? 0) : fmv(year);
      const income = ROUND(a.shares * f);
      res.ordinaryIncome += income;
      let retained = a.shares;
      // Sell-to-cover.
      if (plan.sellToCover && plan.withholdingRate > 0 && f > 0) {
        const coverShares = Math.min(a.shares, ROUND((income * plan.withholdingRate) / fmv(year)));
        if (coverShares > 0) {
          res.sellToCoverProceeds += ROUND(coverShares * fmv(year));
          retained = ROUND(a.shares - coverShares);
        }
      }
      state.lots.set(key, {
        grantId: a.grantId, trancheId: a.trancheId, grantType: "rsu", shares: retained,
        basisPerShare: f, acquisitionYear: grant.has83bElection ? grant.grantYear : year, grantYear: grant.grantYear,
        exerciseYear: null, strike: 0, fmvAtExercise: f,
      });
      res.acquisitions.push({ value: ROUND(retained * fmv(year)), basis: ROUND(retained * f) });
      continue;
    }

    if (a.kind === "exercise") {
      const f = fmv(year);
      const strike = resolveStrikePrice(grant, f);
      const spread = ROUND(a.shares * Math.max(0, f - strike));
      res.strikeCashOutflow += ROUND(a.shares * strike);
      let retained = a.shares;
      if (grant.grantType === "nqso") {
        res.ordinaryIncome += spread;
        if (plan.sellToCover && plan.withholdingRate > 0 && f > 0) {
          const coverShares = Math.min(a.shares, ROUND((spread * plan.withholdingRate) / f));
          if (coverShares > 0) { res.sellToCoverProceeds += ROUND(coverShares * f); retained = ROUND(a.shares - coverShares); }
        }
      } else {
        // ISO: AMT preference, no regular OI; regular basis = strike.
        res.isoSpread += spread;
      }
      const basisPerShare = grant.grantType === "iso" ? strike : f;
      state.lots.set(key, {
        grantId: a.grantId, trancheId: a.trancheId, grantType: grant.grantType, shares: retained,
        basisPerShare, acquisitionYear: year, grantYear: grant.grantYear,
        exerciseYear: year, strike, fmvAtExercise: f,
      });
      res.acquisitions.push({ value: ROUND(retained * f), basis: ROUND(retained * basisPerShare) });
      continue;
    }

    if (a.kind === "sell") {
      const lot = state.lots.get(key);
      if (!lot || lot.shares <= 0) continue;
      const shares = Math.min(a.shares, lot.shares);
      const f = fmv(year);
      res.sellProceeds += ROUND(shares * f);
      res.saleBasisRemoved += ROUND(shares * lot.basisPerShare);

      if (lot.grantType === "iso" && lot.exerciseYear != null) {
        const qualifying = year - lot.grantYear >= 3 && year - lot.exerciseYear >= 2;
        if (qualifying) {
          res.capitalGains += ROUND(shares * Math.max(0, f - lot.basisPerShare));
        } else {
          // Disqualifying: bargain element at exercise → ordinary income; rest → cap gain.
          const bargain = ROUND(shares * Math.max(0, lot.fmvAtExercise - lot.strike));
          res.ordinaryIncome += bargain;
          const remainder = ROUND(shares * (f - lot.fmvAtExercise));
          if (remainder >= 0) res.capitalGains += remainder; // post-exercise appreciation
          else res.capitalGains += remainder; // a loss reduces gains
        }
      } else {
        const gain = ROUND(shares * (f - lot.basisPerShare));
        const longTerm = year - lot.acquisitionYear >= 2;
        if (longTerm) res.capitalGains += gain;
        else res.stCapitalGains += gain;
      }
      lot.shares = ROUND(lot.shares - shares);
      continue;
    }

    if (a.kind === "expire") {
      // Unexercised options expire worthless — no tax, nothing held.
      continue;
    }
  }

  return res;
}
