import type { StockOptionPlan, EquityGrant, GrantType } from "./types";
import { buildGrantTimeline, type EquityAction } from "./timeline";
import { projectFmv, resolveStrikePrice } from "./price-model";

export type FutureActivityKind = "vest" | "exercise" | "sell" | "expire";

export interface FutureActivityEvent {
  year: number;
  kind: FutureActivityKind;
  grantId: string;
  grantLabel: string;          // grantNumber ?? `${ticker} ${grantYear}`
  trancheId: string;
  trancheLabel: string;        // "T1", "T2", … (1-based index within the grant's tranches)
  grantType: GrantType;
  ticker: string | null;
  shares: number;
  pricePerShare: number;       // projected FMV for the event year
  grossValue: number;          // RSU FMV / option intrinsic / sell proceeds / 0 (expire)
  exerciseCost: number | null; // exercise only
  netCash: number | null;      // sell proceeds (+) / exercise strike (−); null for vest/expire
  underwater: boolean;         // expire (lapsed unexercised)
  taxImpact: number | null;    // WIRED — always null this phase
}

export interface FutureActivitySubtotal {
  shares: number;
  grossValue: number;
  exerciseCost: number;
  netCash: number;
  taxImpact: number | null;    // null this phase
}

export interface FutureActivityYearGroup {
  year: number;
  events: FutureActivityEvent[];
  subtotal: FutureActivitySubtotal;
}

export interface FutureActivityModel {
  asOfYear: number;
  planEndYear: number;
  groups: FutureActivityYearGroup[];
  totals: FutureActivitySubtotal;
  hasGrants: boolean;
  hasTaxImpact: boolean;       // false this phase → view renders "pending"/"—"
}

export interface BuildFutureActivityOptions {
  asOfYear: number;            // lower bound; = planStartYear
  planStartYear: number;       // FMV projection base year
  planEndYear: number;         // upper bound — caps the sell tail
}

// Within-year ordering (mirrors computeEquityYear, minus the excluded seed_held).
const KIND_ORDER: Record<FutureActivityKind, number> = { vest: 0, exercise: 1, sell: 2, expire: 3 };

// EquityAction.kind → display kind. seed_held is intentionally absent (dropped).
const DISPLAY_KIND: Partial<Record<EquityAction["kind"], FutureActivityKind>> = {
  acquire_rsu: "vest",
  exercise: "exercise",
  sell: "sell",
  expire: "expire",
};

export function buildFutureActivity(
  plans: StockOptionPlan[],
  opts: BuildFutureActivityOptions,
): FutureActivityModel {
  const { asOfYear, planStartYear, planEndYear } = opts;
  const events: FutureActivityEvent[] = [];

  for (const plan of plans) {
    for (const grant of plan.grants) {
      const trancheLabelById = new Map<string, string>();
      grant.tranches.forEach((t, i) => trancheLabelById.set(t.id, `T${i + 1}`));
      const grantLabel = grant.grantNumber ?? `${plan.ticker ?? "—"} ${grant.grantYear}`;

      for (const action of buildGrantTimeline(grant, plan.strategy, planStartYear)) {
        const kind = DISPLAY_KIND[action.kind];
        if (!kind) continue;                                   // drop seed_held
        if (action.year < asOfYear || action.year > planEndYear) continue; // horizon cap
        events.push(toEvent(plan, grant, action, kind, grantLabel, trancheLabelById, planStartYear));
      }
    }
  }

  const byYear = new Map<number, FutureActivityEvent[]>();
  for (const e of events) {
    const bucket = byYear.get(e.year) ?? byYear.set(e.year, []).get(e.year)!;
    bucket.push(e);
  }

  const groups: FutureActivityYearGroup[] = [...byYear.keys()]
    .sort((a, b) => a - b)
    .map((year) => {
      const evs = byYear.get(year)!.sort(compareEvents);
      return { year, events: evs, subtotal: sumEvents(evs) };
    });

  return {
    asOfYear,
    planEndYear,
    groups,
    totals: sumEvents(events),
    hasGrants: plans.some((p) => p.grants.length > 0),
    hasTaxImpact: false,
  };
}

function toEvent(
  plan: StockOptionPlan,
  grant: EquityGrant,
  action: EquityAction,
  kind: FutureActivityKind,
  grantLabel: string,
  trancheLabelById: Map<string, string>,
  planStartYear: number,
): FutureActivityEvent {
  const fmv = projectFmv(plan.pricePerShare, plan.growthRate, action.year, planStartYear);
  const isOption = grant.grantType !== "rsu";
  const strike = isOption ? resolveStrikePrice(grant, fmv) : 0;

  let grossValue = 0;
  let exerciseCost: number | null = null;
  let netCash: number | null = null;
  let underwater = false;

  switch (kind) {
    case "vest":
      grossValue = action.shares * fmv;
      break;
    case "exercise":
      grossValue = action.shares * Math.max(0, fmv - strike);
      exerciseCost = action.shares * strike;
      netCash = -exerciseCost;
      break;
    case "sell":
      grossValue = action.shares * fmv;
      netCash = grossValue;
      break;
    case "expire":
      grossValue = 0;
      underwater = true;
      break;
  }

  return {
    year: action.year,
    kind,
    grantId: grant.id,
    grantLabel,
    trancheId: action.trancheId,
    trancheLabel: trancheLabelById.get(action.trancheId) ?? "—",
    grantType: grant.grantType,
    ticker: plan.ticker ?? null,
    shares: action.shares,
    pricePerShare: fmv,
    grossValue,
    exerciseCost,
    netCash,
    underwater,
    taxImpact: null,
  };
}

function compareEvents(a: FutureActivityEvent, b: FutureActivityEvent): number {
  if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.grantLabel !== b.grantLabel) return a.grantLabel.localeCompare(b.grantLabel);
  return a.trancheLabel.localeCompare(b.trancheLabel);
}

function sumEvents(evs: FutureActivityEvent[]): FutureActivitySubtotal {
  const s: FutureActivitySubtotal = { shares: 0, grossValue: 0, exerciseCost: 0, netCash: 0, taxImpact: null };
  for (const e of evs) {
    s.shares += e.shares;
    s.grossValue += e.grossValue;
    s.exerciseCost += e.exerciseCost ?? 0;
    s.netCash += e.netCash ?? 0;
  }
  return s;
}
