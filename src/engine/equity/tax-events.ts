import type { StockOptionPlan, EquityGrant, GrantType } from "./types";
import { resolveStrategy } from "./strategy";
import { buildGrantTimeline, type EquityAction } from "./timeline";
import { fmvCurve, resolveStrikePrice } from "./price-model";
import { computeSellToCover } from "./withholding";
import { isQualifyingIsoDisposition, isLongTermHolding } from "./holding-period";

/** One acquired-and-held lot — per ACQUISITION EVENT, not per tranche: a row
 *  partly exercised before the plan holds two. */
interface Lot {
  grantId: string;
  trancheId: string;
  grantType: GrantType;
  shares: number;
  /** Regular-tax basis. DERIVED, never stored: ISO = strike, everything else =
   *  price at acquisition. A stored basis alongside a stored strike and price
   *  would be a third source of truth for a number the other two determine. */
  basisPerShare: number;
  /** AMT basis — FMV at exercise, for every type. Differs from `basisPerShare`
   *  only for an ISO, which is exactly the point: the dual basis is what makes
   *  an AMT charge a TIMING cost rather than a permanent one. Written here
   *  because this is the only place that knows FMV at exercise; first READ by
   *  G8 Plan 2 (audit F23). */
  amtBasisPerShare: number;
  /** Real dates. `exerciseDate` is null for an RSU — there is no exercise. */
  acquisitionDate: string;
  exerciseDate: string | null;
  grantDate: string;
  strike: number;                // options only (for disqualifying bargain element)
  fmvAtExercise: number;         // options only
}

export interface EquityState {
  planStartYear: number;
  actionsByYear: Map<string, Map<number, EquityAction[]>>; // accountId → year → actions
  lots: Map<string, Lot>;        // key = `${grantId}:${lotId}` — see lotKey
  grantsById: Map<string, EquityGrant>;
}

export interface EquityYearResult {
  ordinaryIncome: number;   // W-2 box 1 income (RSU vest, NQSO spread, disqualifying ISO)
  ficaExemptOrdinaryIncome: number; // subset of ordinaryIncome, no FICA (§3121(a)(22))
  isoSpread: number;        // AMT preference
  capitalGains: number;     // long-term
  stCapitalGains: number;   // short-term
  strikeCashOutflow: number;
  sellProceeds: number;
  sellToCoverProceeds: number;
  acquisitions: { value: number; basis: number }[]; // in-kind inflows to the destination account
  saleBasisRemoved: number; // basis to drain from destination account on sells
  details: EquityYearDetail[];
}

export type EquityDetailKind = "vest" | "exercise" | "sell" | "expire";

export interface EquityYearDetail {
  grantId: string;
  trancheId: string;
  grantType: GrantType;
  kind: EquityDetailKind;     // seed_held is NOT emitted (its later sells are)
  shares: number;             // vested / exercised / sold (clamped) / expired
  exercisePrice: number | null;
  exerciseCost: number;       // strike × shares (exercise; ISO included)
  coverShares: number;        // sell-to-cover shares (vest / exercise)
  proceeds: number;           // cover proceeds OR clamped sell proceeds
  fmv: number;                // projected FMV that year
}

const ROUND = (n: number) => Math.round(n * 1e6) / 1e6;
/** Keyed by acquisition event: keying by vesting row alone made the second
 *  `lots.set` overwrite the first and stranded the difference. */
const lotKey = (a: { grantId: string; lotId: string }) => `${a.grantId}:${a.lotId}`;

export function createEquityState(plans: StockOptionPlan[], planStartYear: number): EquityState {
  const actionsByYear = new Map<string, Map<number, EquityAction[]>>();
  const grantsById = new Map<string, EquityGrant>();
  for (const p of plans) {
    const acctStrategy = resolveStrategy(p.strategy, null, null);
    const fmvAt = fmvCurve(p, planStartYear);
    const byYear = new Map<number, EquityAction[]>();
    for (const g of p.grants) {
      grantsById.set(g.id, g);
      for (const a of buildGrantTimeline(g, acctStrategy, planStartYear, fmvAt)) {
        (byYear.get(a.year) ?? byYear.set(a.year, []).get(a.year)!).push(a);
      }
    }
    actionsByYear.set(p.accountId, byYear);
  }
  return { planStartYear, actionsByYear, lots: new Map(), grantsById };
}

function emptyResult(): EquityYearResult {
  return { ordinaryIncome: 0, ficaExemptOrdinaryIncome: 0, isoSpread: 0, capitalGains: 0, stCapitalGains: 0, strikeCashOutflow: 0, sellProceeds: 0, sellToCoverProceeds: 0, acquisitions: [], saleBasisRemoved: 0, details: [] };
}

export function computeEquityYear(plan: StockOptionPlan, state: EquityState, year: number): EquityYearResult {
  const res = emptyResult();
  const actions = state.actionsByYear.get(plan.accountId)?.get(year) ?? [];
  const fmv = fmvCurve(plan, state.planStartYear);

  // Process acquisitions/exercises BEFORE sells in the same year (cashless/sell-to-cover).
  const order: Record<string, number> = { seed_held: 0, acquire_rsu: 1, exercise: 2, sell: 3, expire: 4 };
  const sorted = [...actions].sort((a, b) => order[a.kind] - order[b.kind]);

  for (const a of sorted) {
    const grant = state.grantsById.get(a.grantId)!;
    const key = lotKey(a);

    if (a.kind === "seed_held") {
      // Already vested or exercised before the plan began. Every fact about the
      // acquisition now comes from the DATABASE — `acquired_on` and
      // `price_at_acquisition`, carried onto the action as `a.date` and
      // `a.priceAtAcquisition`. Audit F1/F2/F3.
      //
      // The predecessor invented all three, and every invention lowered the
      // client's tax: basis stepped to TODAY's FMV (erasing the whole pre-plan
      // gain — a $100,000 position sold at plan start showed $0 of tax where
      // ~$16,000 was owed), the acquisition back-dated two years (so every lot
      // read long-term), and `grant.strikePrice ?? 0` read a discount-priced
      // ISO's strike as ZERO, booking all its proceeds as W-2 wages.
      const isRsu = grant.grantType === "rsu";
      // FMV anchor, in order of what we actually know. It must NOT fall back to
      // `fmv(year)`: a grant priced by DISCOUNT resolves its strike off whatever
      // FMV it is handed, so today's higher price would mean a higher strike, a
      // higher basis and LESS tax — the favourable direction this group removes.
      // With no anchor the strike resolves to 0 and basis floors at 0, the
      // largest taxable gain, which is the conservative default.
      const anchor = a.priceAtAcquisition ?? grant.fmvAtGrant ?? null;
      // `resolveStrikePrice` on EVERY path — the predecessor special-cased this
      // one branch, which is what made F3 possible.
      const strike = isRsu ? 0 : resolveStrikePrice(grant, anchor ?? 0);
      const fmvAtAcq = anchor ?? strike;
      const basisPerShare = grant.grantType === "iso" ? strike : fmvAtAcq;
      state.lots.set(key, {
        grantId: a.grantId, trancheId: a.trancheId, grantType: grant.grantType, shares: a.shares,
        basisPerShare,
        amtBasisPerShare: fmvAtAcq,
        acquisitionDate: a.date,
        exerciseDate: isRsu ? null : a.date,
        grantDate: grant.grantDate,
        strike, fmvAtExercise: fmvAtAcq,
      });
      res.acquisitions.push({ value: ROUND(a.shares * fmv(year)), basis: ROUND(a.shares * basisPerShare) });
      continue;
    }

    if (a.kind === "acquire_rsu") {
      const f = grant.has83bElection ? (grant.fmvAtGrant ?? 0) : fmv(year);
      const income = ROUND(a.shares * f);
      res.ordinaryIncome += income;
      const cover = computeSellToCover({
        taxableIncome: income, fmvAtYear: fmv(year), shares: a.shares,
        sellToCover: plan.sellToCover, withholdingRate: plan.withholdingRate,
      });
      res.sellToCoverProceeds += cover.proceeds;
      const retained = cover.retained;
      state.lots.set(key, {
        grantId: a.grantId, trancheId: a.trancheId, grantType: "rsu", shares: retained,
        basisPerShare: f, amtBasisPerShare: f,
        // `a.date` is the grant date for an 83(b) grant and the vest date
        // otherwise — timeline.ts owns that distinction, which is the whole
        // effect of the election on the holding period.
        acquisitionDate: a.date,
        exerciseDate: null,
        grantDate: grant.grantDate,
        strike: 0, fmvAtExercise: f,
      });
      res.acquisitions.push({ value: ROUND(retained * fmv(year)), basis: ROUND(retained * f) });
      res.details.push({
        grantId: a.grantId, trancheId: a.trancheId, grantType: "rsu", kind: "vest",
        shares: a.shares, exercisePrice: null, exerciseCost: 0,
        coverShares: cover.coverShares, proceeds: cover.proceeds, fmv: fmv(year),
      });
      continue;
    }

    if (a.kind === "exercise") {
      const f = fmv(year);
      const strike = resolveStrikePrice(grant, f);
      const spread = ROUND(a.shares * Math.max(0, f - strike));
      res.strikeCashOutflow += ROUND(a.shares * strike);
      let retained = a.shares;
      let cover = { coverShares: 0, proceeds: 0, retained: a.shares };
      if (grant.grantType === "nqso") {
        res.ordinaryIncome += spread;
        cover = computeSellToCover({
          taxableIncome: spread, fmvAtYear: f, shares: a.shares,
          sellToCover: plan.sellToCover, withholdingRate: plan.withholdingRate,
        });
        res.sellToCoverProceeds += cover.proceeds;
        retained = cover.retained;
      } else {
        // ISO: AMT preference, no regular OI; regular basis = strike.
        res.isoSpread += spread;
      }
      const basisPerShare = grant.grantType === "iso" ? strike : f;
      state.lots.set(key, {
        grantId: a.grantId, trancheId: a.trancheId, grantType: grant.grantType, shares: retained,
        basisPerShare, amtBasisPerShare: f,
        acquisitionDate: a.date,
        exerciseDate: a.date,
        grantDate: grant.grantDate,
        strike, fmvAtExercise: f,
      });
      res.acquisitions.push({ value: ROUND(retained * f), basis: ROUND(retained * basisPerShare) });
      res.details.push({
        grantId: a.grantId, trancheId: a.trancheId, grantType: grant.grantType, kind: "exercise",
        shares: a.shares, exercisePrice: strike, exerciseCost: ROUND(a.shares * strike),
        coverShares: cover.coverShares, proceeds: cover.proceeds, fmv: f,
      });
      continue;
    }

    if (a.kind === "sell") {
      const lot = state.lots.get(key);
      if (!lot || lot.shares <= 0) continue;
      const shares = Math.min(a.shares, lot.shares);
      const f = fmv(year);
      res.sellProceeds += ROUND(shares * f);
      res.saleBasisRemoved += ROUND(shares * lot.basisPerShare);

      if (lot.grantType === "iso" && lot.exerciseDate != null) {
        const qualifying = isQualifyingIsoDisposition({
          grantDate: lot.grantDate,
          exerciseDate: lot.exerciseDate,
          dispositionDate: a.date,
        });
        if (qualifying) {
          // Signed — a qualifying ISO disposition below basis is a genuine
          // long-term capital loss. (The non-ISO branch below was already
          // signed; this branch was the outlier.)
          res.capitalGains += ROUND(shares * (f - lot.basisPerShare));
        } else {
          // Disqualifying disposition (IRC §422(c)(2)/§421, Pub 525): ordinary income is the
          // LESSER of the exercise-date bargain element or the actual gain on sale. A drop after
          // exercise caps OI at (salePrice − strike) and is NOT a separate capital loss.
          const oiPerShare = Math.min(Math.max(0, lot.fmvAtExercise - lot.strike), Math.max(0, f - lot.strike));
          const oi = ROUND(shares * oiPerShare);
          res.ordinaryIncome += oi;
          // Box 1 income, but NOT §3121(a) wages — IRC §3121(a)(22) excludes
          // remuneration on a disposition of ISO/ESPP stock from FICA. This is
          // the ONLY equity leg that is exempt: RSU vests and NQSO spreads above
          // are ordinary payroll wages.
          res.ficaExemptOrdinaryIncome += oi;
          // Residual vs stepped-up basis (strike + OI/share). Up → post-exercise appreciation;
          // flat-after-drop → 0; below strike → a true capital loss.
          const gain = ROUND(shares * (f - lot.strike) - shares * oiPerShare);
          // A disqualifying disposition fails at least one §422(a)(1) leg, but it
          // can still clear the one-year §1222(3) test — failing the two-year
          // GRANT leg alone leaves a long-term residual. Measured from the
          // exercise date, which is when the stock itself was acquired.
          const longTerm = isLongTermHolding(lot.exerciseDate, a.date);
          if (longTerm) res.capitalGains += gain; else res.stCapitalGains += gain;
        }
      } else {
        const gain = ROUND(shares * (f - lot.basisPerShare));
        const longTerm = isLongTermHolding(lot.acquisitionDate, a.date);
        if (longTerm) res.capitalGains += gain;
        else res.stCapitalGains += gain;
      }
      lot.shares = ROUND(lot.shares - shares);
      res.details.push({
        grantId: a.grantId, trancheId: a.trancheId, grantType: lot.grantType, kind: "sell",
        shares, exercisePrice: null, exerciseCost: 0,
        coverShares: 0, proceeds: ROUND(shares * f), fmv: f,
      });
      continue;
    }

    if (a.kind === "expire") {
      // Unexercised options expire worthless — no tax, nothing held.
      res.details.push({
        grantId: a.grantId, trancheId: a.trancheId, grantType: grant.grantType, kind: "expire",
        shares: a.shares, exercisePrice: null, exerciseCost: 0,
        coverShares: 0, proceeds: 0, fmv: fmv(year),
      });
      continue;
    }
  }

  return res;
}
