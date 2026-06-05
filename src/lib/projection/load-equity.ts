import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  stockOptionAccounts,
  stockOptionGrants,
  stockOptionVestTranches,
  stockOptionPlannedEvents,
} from "@/db/schema";
import type { StockOptionPlan, EquityStrategy } from "@/engine/equity/types";

const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : parseFloat(v);
const numN = (v: string | number | null | undefined): number | null =>
  v == null ? null : typeof v === "number" ? v : parseFloat(v);
const yearOf = (isoDate: string): number => parseInt(isoDate.slice(0, 4), 10);

// Use Pick to include only the columns assembleStockOptionPlans needs,
// so the pure assembler doesn't require timestamp fields from $inferSelect.
type ExtRow = Pick<
  typeof stockOptionAccounts.$inferSelect,
  | "accountId"
  | "ticker"
  | "isPublic"
  | "pricePerShare"
  | "destinationAccountId"
  | "autoCreateDestination"
  | "sellToCover"
  | "withholdingRate"
  | "defaultExerciseTiming"
  | "defaultExerciseYear"
  | "defaultSellTiming"
  | "defaultSellYear"
  | "defaultSellPercentPerYear"
  | "defaultSellStartYear"
>;

type GrantRow = Pick<
  typeof stockOptionGrants.$inferSelect,
  | "id"
  | "accountId"
  | "grantNumber"
  | "grantType"
  | "grantDate"
  | "sharesGranted"
  | "has83bElection"
  | "fmvAtGrant"
  | "strikePrice"
  | "strikeDiscountPct"
  | "expirationDate"
  | "exerciseTiming"
  | "exerciseYear"
  | "sellTiming"
  | "sellYear"
  | "sellPercentPerYear"
  | "sellStartYear"
  | "sortOrder"
>;

type TrancheRow = Pick<
  typeof stockOptionVestTranches.$inferSelect,
  | "id"
  | "grantId"
  | "vestDate"
  | "shares"
  | "sharesExercised"
  | "sharesSold"
  | "exerciseTiming"
  | "exerciseYear"
  | "sellTiming"
  | "sellYear"
  | "sellPercentPerYear"
  | "sellStartYear"
  | "sortOrder"
>;

type PlannedRow = Pick<
  typeof stockOptionPlannedEvents.$inferSelect,
  "id" | "grantId" | "trancheId" | "year" | "action" | "shares" | "pct"
>;

export interface AssembleInput {
  extensions: ExtRow[];
  grants: GrantRow[];
  tranches: TrancheRow[];
  plannedEvents: PlannedRow[];
  ownerByAccount: Record<string, "client" | "spouse">;
  growthByAccount: Record<string, number>;
}

function strategyFrom(r: {
  exerciseTiming: EquityStrategy["exerciseTiming"] | null;
  exerciseYear: number | null;
  sellTiming: EquityStrategy["sellTiming"] | null;
  sellYear: number | null;
  sellPercentPerYear: string | null;
  sellStartYear: number | null;
}): EquityStrategy {
  return {
    exerciseTiming: r.exerciseTiming ?? null,
    exerciseYear: r.exerciseYear ?? null,
    sellTiming: r.sellTiming ?? null,
    sellYear: r.sellYear ?? null,
    sellPercentPerYear: numN(r.sellPercentPerYear),
    sellStartYear: r.sellStartYear ?? null,
  };
}

/** Pure assembler — no DB. Nests rows into StockOptionPlan[]. */
export function assembleStockOptionPlans(input: AssembleInput): StockOptionPlan[] {
  const tranchesByGrant = new Map<string, TrancheRow[]>();
  for (const t of input.tranches) {
    (tranchesByGrant.get(t.grantId) ?? tranchesByGrant.set(t.grantId, []).get(t.grantId)!).push(t);
  }
  const plannedByGrant = new Map<string, PlannedRow[]>();
  for (const p of input.plannedEvents) {
    (plannedByGrant.get(p.grantId) ?? plannedByGrant.set(p.grantId, []).get(p.grantId)!).push(p);
  }
  const grantsByAccount = new Map<string, GrantRow[]>();
  for (const g of input.grants) {
    (grantsByAccount.get(g.accountId) ?? grantsByAccount.set(g.accountId, []).get(g.accountId)!).push(g);
  }

  return input.extensions.map((ext) => ({
    accountId: ext.accountId,
    ticker: ext.ticker,
    pricePerShare: num(ext.pricePerShare),
    growthRate: input.growthByAccount[ext.accountId] ?? 0.07,
    destinationAccountId: ext.destinationAccountId,
    autoCreateDestination: ext.autoCreateDestination,
    sellToCover: ext.sellToCover,
    withholdingRate: num(ext.withholdingRate),
    owner: input.ownerByAccount[ext.accountId] ?? "client",
    strategy: {
      exerciseTiming: ext.defaultExerciseTiming,
      exerciseYear: ext.defaultExerciseYear,
      sellTiming: ext.defaultSellTiming,
      sellYear: ext.defaultSellYear,
      sellPercentPerYear: numN(ext.defaultSellPercentPerYear),
      sellStartYear: ext.defaultSellStartYear,
    },
    grants: (grantsByAccount.get(ext.accountId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((g) => ({
        id: g.id,
        grantNumber: g.grantNumber,
        grantType: g.grantType,
        grantYear: yearOf(g.grantDate),
        sharesGranted: num(g.sharesGranted),
        has83bElection: g.has83bElection,
        fmvAtGrant: numN(g.fmvAtGrant),
        strikePrice: numN(g.strikePrice),
        strikeDiscountPct: numN(g.strikeDiscountPct),
        expirationYear: g.expirationDate ? yearOf(g.expirationDate) : null,
        strategy: strategyFrom(g),
        tranches: (tranchesByGrant.get(g.id) ?? [])
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((t) => ({
            id: t.id,
            vestYear: yearOf(t.vestDate),
            shares: num(t.shares),
            sharesExercised: num(t.sharesExercised),
            sharesSold: num(t.sharesSold),
            strategy: strategyFrom(t),
          })),
        plannedEvents: (plannedByGrant.get(g.id) ?? []).map((p) => ({
          year: p.year,
          action: p.action,
          shares: numN(p.shares),
          pct: numN(p.pct),
          trancheId: p.trancheId,
        })),
      })),
  }));
}

/** DB query wrapper — load every stock_options plan for a (client, scenario). */
export async function loadStockOptionPlans(
  clientId: string,
  scenarioId: string,
  growthByAccount: Record<string, number>,
  ownerByAccount: Record<string, "client" | "spouse">,
): Promise<StockOptionPlan[]> {
  const acctRows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.clientId, clientId),
        eq(accounts.scenarioId, scenarioId),
        eq(accounts.category, "stock_options"),
      ),
    );
  const ids = acctRows.map((a) => a.id);
  if (ids.length === 0) return [];

  const [extensions, grants] = await Promise.all([
    db.select({
      accountId: stockOptionAccounts.accountId,
      ticker: stockOptionAccounts.ticker,
      isPublic: stockOptionAccounts.isPublic,
      pricePerShare: stockOptionAccounts.pricePerShare,
      destinationAccountId: stockOptionAccounts.destinationAccountId,
      autoCreateDestination: stockOptionAccounts.autoCreateDestination,
      sellToCover: stockOptionAccounts.sellToCover,
      withholdingRate: stockOptionAccounts.withholdingRate,
      defaultExerciseTiming: stockOptionAccounts.defaultExerciseTiming,
      defaultExerciseYear: stockOptionAccounts.defaultExerciseYear,
      defaultSellTiming: stockOptionAccounts.defaultSellTiming,
      defaultSellYear: stockOptionAccounts.defaultSellYear,
      defaultSellPercentPerYear: stockOptionAccounts.defaultSellPercentPerYear,
      defaultSellStartYear: stockOptionAccounts.defaultSellStartYear,
    }).from(stockOptionAccounts).where(inArray(stockOptionAccounts.accountId, ids)),
    db.select({
      id: stockOptionGrants.id,
      accountId: stockOptionGrants.accountId,
      grantNumber: stockOptionGrants.grantNumber,
      grantType: stockOptionGrants.grantType,
      grantDate: stockOptionGrants.grantDate,
      sharesGranted: stockOptionGrants.sharesGranted,
      has83bElection: stockOptionGrants.has83bElection,
      fmvAtGrant: stockOptionGrants.fmvAtGrant,
      strikePrice: stockOptionGrants.strikePrice,
      strikeDiscountPct: stockOptionGrants.strikeDiscountPct,
      expirationDate: stockOptionGrants.expirationDate,
      exerciseTiming: stockOptionGrants.exerciseTiming,
      exerciseYear: stockOptionGrants.exerciseYear,
      sellTiming: stockOptionGrants.sellTiming,
      sellYear: stockOptionGrants.sellYear,
      sellPercentPerYear: stockOptionGrants.sellPercentPerYear,
      sellStartYear: stockOptionGrants.sellStartYear,
      sortOrder: stockOptionGrants.sortOrder,
    }).from(stockOptionGrants).where(inArray(stockOptionGrants.accountId, ids)),
  ]);
  const grantIds = grants.map((g) => g.id);
  const [tranches, plannedEvents] = grantIds.length
    ? await Promise.all([
        db.select({
          id: stockOptionVestTranches.id,
          grantId: stockOptionVestTranches.grantId,
          vestDate: stockOptionVestTranches.vestDate,
          shares: stockOptionVestTranches.shares,
          sharesExercised: stockOptionVestTranches.sharesExercised,
          sharesSold: stockOptionVestTranches.sharesSold,
          exerciseTiming: stockOptionVestTranches.exerciseTiming,
          exerciseYear: stockOptionVestTranches.exerciseYear,
          sellTiming: stockOptionVestTranches.sellTiming,
          sellYear: stockOptionVestTranches.sellYear,
          sellPercentPerYear: stockOptionVestTranches.sellPercentPerYear,
          sellStartYear: stockOptionVestTranches.sellStartYear,
          sortOrder: stockOptionVestTranches.sortOrder,
        }).from(stockOptionVestTranches).where(inArray(stockOptionVestTranches.grantId, grantIds)),
        db.select({
          id: stockOptionPlannedEvents.id,
          grantId: stockOptionPlannedEvents.grantId,
          trancheId: stockOptionPlannedEvents.trancheId,
          year: stockOptionPlannedEvents.year,
          action: stockOptionPlannedEvents.action,
          shares: stockOptionPlannedEvents.shares,
          pct: stockOptionPlannedEvents.pct,
        }).from(stockOptionPlannedEvents).where(inArray(stockOptionPlannedEvents.grantId, grantIds)),
      ])
    : [[], []];

  return assembleStockOptionPlans({
    extensions,
    grants,
    tranches,
    plannedEvents,
    ownerByAccount,
    growthByAccount,
  });
}
