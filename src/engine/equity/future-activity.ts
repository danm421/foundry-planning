import type { StockOptionPlan, EquityGrant, GrantType } from "./types";
import { createEquityState, computeEquityYear } from "./tax-events";

export interface FutureActivityGrantYearRow {
  year: number;
  grantId: string;              // stable identity (grantNumber is display-only)
  owner: "client" | "spouse";
  planLabel: string;            // ticker ?? "—"
  grantNumber: string;          // grantNumber ?? `${ticker} ${grantYear}`
  grantType: GrantType;
  grantDate: string;            // grant year (only precision we have)
  sharesVested: number;         // RSU vest shares this year
  sharesExercised: number;      // option exercise shares this year
  exercisePrice: number | null; // strike (options)
  exerciseCost: number;         // strike × exercised
  sharesSold: number;           // cover shares + strategy-sell shares
  hasSellToCover: boolean;      // any cover shares → row tag
  salePrice: number;            // projected FMV this year
  grossProceeds: number;        // cover proceeds + strategy-sell proceeds
  netProceeds: number;          // grossProceeds − exerciseCost
  expiredShares: number;        // unexercised options that lapsed
  underwater: boolean;          // any expiry this grant-year
  taxImpact: number | null;     // always null — joint per-year figure, not split per grant
}

export interface FutureActivitySubtotal {
  sharesVested: number;
  sharesExercised: number;
  exerciseCost: number;
  sharesSold: number;
  grossProceeds: number;
  netProceeds: number;
  taxImpact: number | null;     // per-year additional tax (null when no counterfactual entry)
}

export interface FutureActivityYearGroup {
  year: number;
  rows: FutureActivityGrantYearRow[];
  subtotal: FutureActivitySubtotal;
}

export interface FutureActivityModel {
  asOfYear: number;
  planEndYear: number;
  groups: FutureActivityYearGroup[];
  totals: FutureActivitySubtotal;
  hasGrants: boolean;
  hasTaxImpact: boolean;        // true when at least one year carries a tax figure (= totals.taxImpact != null)
}

export interface BuildFutureActivityOptions {
  asOfYear: number;             // lower bound; = planStartYear
  planStartYear: number;        // FMV projection base year
  planEndYear: number;          // upper bound — caps the tail
  // Per-year additional tax from the Tax Impact report (equityTaxImpact.totalTax).
  // Joins onto year subtotals + grand total only — the counterfactual is a joint
  // per-year figure and can't be split per grant, so per-grant rows stay null.
  taxByYear?: ReadonlyMap<number, number>;
}

const ROUND = (n: number) => Math.round(n * 1e6) / 1e6;

export function buildFutureActivity(
  plans: StockOptionPlan[],
  opts: BuildFutureActivityOptions,
): FutureActivityModel {
  const { asOfYear, planStartYear, planEndYear, taxByYear } = opts;

  // grantId → { plan, grant } for identity lookup.
  const idInfo = new Map<string, { plan: StockOptionPlan; grant: EquityGrant }>();
  for (const plan of plans) for (const grant of plan.grants) idInfo.set(grant.id, { plan, grant });

  // Run the cash-flow engine over the horizon; the lot state advances year over year.
  const state = createEquityState(plans, planStartYear);
  const rowByKey = new Map<string, FutureActivityGrantYearRow>();

  for (let year = planStartYear; year <= planEndYear; year++) {
    for (const plan of plans) {
      const res = computeEquityYear(plan, state, year); // mutates state.lots
      if (year < asOfYear) continue;                    // advance lots, don't emit
      for (const d of res.details) {
        const info = idInfo.get(d.grantId);
        if (!info) continue;
        const { grant } = info;
        const key = `${d.grantId}:${year}`;
        let row = rowByKey.get(key);
        if (!row) {
          row = {
            year,
            grantId: d.grantId,
            owner: plan.owner,
            planLabel: plan.ticker ?? "—",
            grantNumber: grant.grantNumber ?? `${plan.ticker ?? "—"} ${grant.grantYear}`,
            grantType: grant.grantType,
            grantDate: String(grant.grantYear),
            sharesVested: 0, sharesExercised: 0, exercisePrice: null, exerciseCost: 0,
            sharesSold: 0, hasSellToCover: false, salePrice: d.fmv, grossProceeds: 0,
            netProceeds: 0, expiredShares: 0, underwater: false, taxImpact: null,
          };
          rowByKey.set(key, row);
        }
        switch (d.kind) {
          case "vest":
            row.sharesVested = ROUND(row.sharesVested + d.shares);
            break;
          case "exercise":
            row.sharesExercised = ROUND(row.sharesExercised + d.shares);
            row.exercisePrice = d.exercisePrice;
            row.exerciseCost = ROUND(row.exerciseCost + d.exerciseCost);
            break;
          case "expire":
            row.expiredShares = ROUND(row.expiredShares + d.shares);
            row.underwater = true;
            break;
        }
        if (d.kind === "sell") {
          row.sharesSold = ROUND(row.sharesSold + d.shares);
        } else if (d.coverShares > 0) {
          row.sharesSold = ROUND(row.sharesSold + d.coverShares);
          row.hasSellToCover = true;
        }
        row.grossProceeds = ROUND(row.grossProceeds + d.proceeds);
        // salePrice (projected FMV) is constant per grant-year, set at row init.
      }
    }
  }

  for (const row of rowByKey.values()) {
    row.netProceeds = ROUND(row.grossProceeds - row.exerciseCost);
  }

  const byYear = new Map<number, FutureActivityGrantYearRow[]>();
  for (const row of rowByKey.values()) {
    if (!byYear.has(row.year)) byYear.set(row.year, []);
    byYear.get(row.year)!.push(row);
  }

  const groups: FutureActivityYearGroup[] = [...byYear.keys()]
    .sort((a, b) => a - b)
    .map((year) => {
      const rows = byYear.get(year)!.sort(compareRows);
      const subtotal = sumRows(rows);
      subtotal.taxImpact = taxByYear?.get(year) ?? null;
      return { year, rows, subtotal };
    });

  // Grand total = sum of the per-year tax figures that are present. Stays null
  // when no year carries a counterfactual entry (no projection ran, or an empty map).
  const totals = sumRows([...rowByKey.values()]);
  for (const g of groups) {
    if (g.subtotal.taxImpact !== null) totals.taxImpact = ROUND((totals.taxImpact ?? 0) + g.subtotal.taxImpact);
  }

  return {
    asOfYear,
    planEndYear,
    groups,
    totals,
    hasGrants: plans.some((p) => p.grants.length > 0),
    hasTaxImpact: totals.taxImpact !== null,
  };
}

function compareRows(a: FutureActivityGrantYearRow, b: FutureActivityGrantYearRow): number {
  return a.grantNumber.localeCompare(b.grantNumber);
}

function sumRows(rows: FutureActivityGrantYearRow[]): FutureActivitySubtotal {
  const s: FutureActivitySubtotal = {
    sharesVested: 0, sharesExercised: 0, exerciseCost: 0, sharesSold: 0,
    grossProceeds: 0, netProceeds: 0, taxImpact: null,
  };
  for (const r of rows) {
    s.sharesVested = ROUND(s.sharesVested + r.sharesVested);
    s.sharesExercised = ROUND(s.sharesExercised + r.sharesExercised);
    s.exerciseCost = ROUND(s.exerciseCost + r.exerciseCost);
    s.sharesSold = ROUND(s.sharesSold + r.sharesSold);
    s.grossProceeds = ROUND(s.grossProceeds + r.grossProceeds);
    s.netProceeds = ROUND(s.netProceeds + r.netProceeds);
  }
  return s;
}
