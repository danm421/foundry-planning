// src/lib/portal/load-dashboard.ts
//
// Server-side aggregator for the portal Dashboard. Orchestrates the existing
// portal loaders + two focused queries and threads them through the pure
// dashboard-summary module. Scenario = base case (matches AccountsSection). No
// API route: this is consumed by the <PortalDashboard> server component.
import { and, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, liabilities, plaidTransactions, scenarios } from "@/db/schema";
import { loadBudgetSummary, currentMonthRange } from "@/lib/portal/load-budget-data";
import { loadRecurringsData } from "@/lib/portal/load-recurrings-data";
import {
  loadPortalDebt,
  loadPortalTrendTransactions,
} from "@/lib/portal/load-portal-financials";
import { summarizeNetWorth } from "@/lib/portal/portal-networth";
import { reconstructDailyNetWorth, type TrendPoint } from "@/lib/portal/networth-trend";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";
import {
  spendingPaceCurve,
  netThisMonth,
  dueWithinDays,
  topCategories,
  type PacePoint,
  type DueRecurring,
  type TopCategory,
} from "@/lib/portal/dashboard-summary";

export interface ReviewTxn {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: number;
  accountName: string | null;
}

export interface PortalDashboardDTO {
  spending: {
    left: number;
    budgeted: number;
    spent: number;
    pace: PacePoint[];
    underBy: number;
    month: string;
  };
  netWorth: {
    assets: number;
    debt: number;
    netWorth: number;
    series: TrendPoint[];
    asOfDate: string;
  };
  toReview: { count: number; sample: ReviewTxn[] };
  topCategories: TopCategory[];
  netThisMonth: {
    net: number;
    income: number;
    spent: number;
    prior: number;
    deltaAbs: number;
    deltaPct: number | null;
  };
  recurrings: DueRecurring[];
}

function priorMonthRange(now: Date): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1));
  const { from, to } = currentMonthRange(start);
  return { from, to };
}

export async function loadPortalDashboard(
  clientId: string,
  now: Date,
): Promise<PortalDashboardDTO> {
  const today = now.toISOString().slice(0, 10);
  const { from, to } = currentMonthRange(now);
  const prior = priorMonthRange(now);

  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  // Run the independent loaders/queries in parallel.
  const [
    budget,
    recurringsData,
    monthTxns,
    monthAgg,
    priorAgg,
    uncategorized,
    accountRows,
  ] = await Promise.all([
    loadBudgetSummary(clientId, now),
    loadRecurringsData(clientId, now),
    // This month's expense txns (signed) for the pace curve.
    db
      .select({ date: plaidTransactions.date, amount: plaidTransactions.amount })
      .from(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          eq(plaidTransactions.type, "expense"),
          gte(plaidTransactions.date, from),
          lte(plaidTransactions.date, to),
        ),
      ),
    // Current-month income/spend raw posted totals for the net-this-month tile (like-for-like with priorAgg).
    db
      .select({
        type: plaidTransactions.type,
        total: sql<string>`sum(${plaidTransactions.amount})`,
      })
      .from(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          gte(plaidTransactions.date, from),
          lte(plaidTransactions.date, to),
        ),
      )
      .groupBy(plaidTransactions.type),
    // Prior-month income/spend totals for the net-this-month delta.
    db
      .select({
        type: plaidTransactions.type,
        total: sql<string>`sum(${plaidTransactions.amount})`,
      })
      .from(plaidTransactions)
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          gte(plaidTransactions.date, prior.from),
          lte(plaidTransactions.date, prior.to),
        ),
      )
      .groupBy(plaidTransactions.type),
    // Uncategorized expense count + sample ("to review").
    db
      .select({
        id: plaidTransactions.id,
        date: plaidTransactions.date,
        name: plaidTransactions.name,
        merchantName: plaidTransactions.merchantName,
        amount: plaidTransactions.amount,
        accountName: accounts.name,
      })
      .from(plaidTransactions)
      .leftJoin(accounts, eq(accounts.id, plaidTransactions.accountId))
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          ne(plaidTransactions.type, "transfer"),
          isNull(plaidTransactions.reviewedAt),
        ),
      )
      .orderBy(desc(plaidTransactions.date), desc(plaidTransactions.id))
      .limit(5),
    // Visible asset accounts for net worth (base-case scenario).
    scenario
      ? db
          .select({
            id: accounts.id,
            category: accounts.category,
            value: accounts.value,
            isDefaultChecking: accounts.isDefaultChecking,
            parentAccountId: accounts.parentAccountId,
          })
          .from(accounts)
          .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id)))
      : Promise.resolve([]),
  ]);

  // ---- Net worth (mirror AccountsSection) ----
  const visible = accountRows.filter((r) =>
    isPortalVisibleAccount({
      category: r.category,
      isDefaultChecking: r.isDefaultChecking,
      parentAccountId: r.parentAccountId,
    }),
  );
  const assetIds = visible.map((r) => r.id);
  const totalAssets = visible.reduce((s, r) => s + Number(r.value || "0"), 0);
  const debtRows = scenario ? await loadPortalDebt(clientId, scenario.id) : [];
  const debtTotal = debtRows.reduce((s, r) => s + r.balance, 0);
  const nw = summarizeNetWorth({ assets: totalAssets, debt: debtTotal });

  const liabPlaidIds = (
    scenario
      ? await db
          .select({ plaidAccountId: liabilities.plaidAccountId })
          .from(liabilities)
          .where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenario.id)))
      : []
  )
    .map((r) => r.plaidAccountId)
    .filter((x): x is string => x != null);
  const trendTxns = await loadPortalTrendTransactions(clientId, assetIds, liabPlaidIds);
  const startDate =
    trendTxns.length > 0
      ? trendTxns.reduce((min, t) => (t.date < min ? t.date : min), today)
      : today;
  const series = reconstructDailyNetWorth({
    netWorthNow: nw.netWorth,
    asOfDate: today,
    startDate,
    transactions: trendTxns,
  });

  // ---- Net this month ----
  let currentIncome = 0;
  let currentSpent = 0;
  for (const row of monthAgg) {
    const total = Number(row.total ?? 0);
    if (row.type === "income") currentIncome += -total; // Plaid: money in is negative
    else if (row.type === "expense") currentSpent += total;
  }
  let priorIncome = 0;
  let priorSpent = 0;
  for (const row of priorAgg) {
    const total = Number(row.total ?? 0);
    if (row.type === "income") priorIncome += -total; // Plaid: money in is negative
    else if (row.type === "expense") priorSpent += total;
  }
  const net = netThisMonth({
    income: currentIncome,
    spent: currentSpent,
    priorIncome,
    priorSpent,
  });

  // ---- Pace curve ----
  const pace = spendingPaceCurve({
    dailySpend: monthTxns.map((t) => ({ date: t.date, amount: Number(t.amount) })),
    totalBudget: budget.totalBudget,
    now,
  });

  // ---- To-review count (cheap COUNT alongside the sample) ----
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(plaidTransactions)
    .where(
      and(
        eq(plaidTransactions.clientId, clientId),
        eq(plaidTransactions.excluded, false),
        ne(plaidTransactions.type, "transfer"),
        isNull(plaidTransactions.reviewedAt),
      ),
    );

  return {
    spending: {
      left: budget.totalRemaining,
      budgeted: budget.totalBudget,
      spent: budget.totalSpent,
      pace: pace.points,
      underBy: pace.underBy,
      month: budget.month,
    },
    netWorth: {
      assets: nw.assets,
      debt: nw.debt,
      netWorth: nw.netWorth,
      series,
      asOfDate: today,
    },
    toReview: {
      count: count ?? 0,
      sample: uncategorized.map((t) => ({
        id: t.id,
        date: t.date,
        name: t.name,
        merchantName: t.merchantName,
        amount: Number(t.amount),
        accountName: t.accountName,
      })),
    },
    topCategories: topCategories(budget.groups, 5),
    netThisMonth: {
      net: net.net,
      income: currentIncome,
      spent: currentSpent,
      prior: net.prior,
      deltaAbs: net.deltaAbs,
      deltaPct: net.deltaPct,
    },
    recurrings: dueWithinDays(recurringsData.recurrings, now, 14),
  };
}
