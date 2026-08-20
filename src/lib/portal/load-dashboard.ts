// src/lib/portal/load-dashboard.ts
//
// Server-side aggregator for the portal Dashboard. Orchestrates the existing
// portal loaders + two focused queries and threads them through the pure
// dashboard-summary module. Scenario = base case (matches AccountsSection).
// Consumed by the <PortalDashboard> server component and by
// GET /api/portal/dashboard (the mobile app's home screen).
//
// Goal funding is the one tile that reads the PLAN rather than Plaid: it runs
// the base-case projection through `buildGoalFunding`. That is the most
// expensive thing on this page, so it runs inside the same Promise.all as the
// queries and fails soft — see `loadGoalFunding`.
import { and, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  clients,
  liabilities,
  plaidTransactions,
  scenarios,
  transactionCategories,
} from "@/db/schema";
import { loadBudgetSummary, currentMonthRange } from "@/lib/portal/load-budget-data";
import { loadRecurringsData } from "@/lib/portal/load-recurrings-data";
import {
  loadPortalDebt,
  loadPortalTrendTransactions,
} from "@/lib/portal/load-portal-financials";
import { DEFAULT_PORTAL_PRIVACY, type PortalPrivacy } from "@/lib/portal/privacy";
import { summarizeNetWorth } from "@/lib/portal/portal-networth";
import { reconstructDailyNetWorth } from "@/lib/portal/networth-trend";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";
import { assetCategoryTotals } from "@/lib/portal/account-rail";
import { buildGoalFunding } from "@/lib/portal/goal-funding";
import {
  spendingPaceCurve,
  netThisMonth,
  dueWithinDays,
  topCategories,
} from "@/lib/portal/dashboard-summary";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";
import { retirementYearOf } from "@/lib/presentations/pages/retirement-summary/aggregate";
import { runProjection } from "@/engine";
import type {
  ReviewTxn,
  NetWorthLine,
  NetWorthGroupLine,
  PortalGoalFunding,
  SpendingGroupLine,
  PortalDashboardDTO,
} from "@/lib/portal/contracts";
export type {
  ReviewTxn,
  NetWorthLine,
  NetWorthGroupLine,
  PortalGoalFunding,
  SpendingGroupLine,
  PortalDashboardDTO,
};

function priorMonthRange(now: Date): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1));
  const { from, to } = currentMonthRange(start);
  return { from, to };
}

/** Zeroed budget summary for when the client doesn't share budgets. */
function emptyBudget(month: string): Awaited<ReturnType<typeof loadBudgetSummary>> {
  return {
    month,
    totalBudget: 0,
    totalSpent: 0,
    totalRemaining: 0,
    incomeThisMonth: 0,
    groups: [],
    excluded: [],
    totalExcluded: 0,
  };
}

/**
 * Percent-funded per goal, from a base-case projection.
 *
 * Fail-soft, like the advisor Overview: a household that cannot be projected
 * (no base scenario, no accounts, a loader fault) reports `projected: false`
 * and the tile says so. It must never take the whole dashboard down — every
 * other tile on this page reads Plaid data that has nothing to do with the
 * projection.
 *
 * `projected` is what separates "this plan has no goals yet" from "the
 * projection did not run". Collapsing both to an empty array is how the tile
 * would tell a household with a perfectly good plan that it had never been
 * projected. `ClientNotFoundError` is deliberately NOT swallowed — that is a
 * real access/lookup fault, and `get-overview-data.ts` rethrows it too.
 */
async function loadGoalFunding(
  clientId: string,
  firmId: string,
): Promise<{ goals: PortalGoalFunding[]; projected: boolean }> {
  try {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
    const years = runProjection(effectiveTree);
    return {
      goals: buildGoalFunding({
        years,
        accounts: effectiveTree.accounts,
        expenses: effectiveTree.expenses,
        familyMemberNamesById: new Map(
          (effectiveTree.familyMembers ?? []).map((m) => [m.id, m.firstName]),
        ),
        retirementYear: retirementYearOf(effectiveTree),
      }),
      projected: true,
    };
  } catch (err) {
    if (err instanceof ClientNotFoundError) throw err;
    console.error(`[portal-dashboard] goal funding failed for clientId=${clientId}`, err);
    return { goals: [], projected: false };
  }
}

export interface LoadPortalDashboardOptions {
  /**
   * Run the base-case projection for the Goals-funded tile. Default true.
   *
   * Off for `GET /api/portal/dashboard`: the mobile home screen renders no
   * goals tile, and it refetches on every app open and pull-to-refresh — it
   * would pay for the most expensive thing on this page and throw the answer
   * away. Turn it back on the same commit a mobile goals tile lands.
   */
  includeGoals?: boolean;
  /**
   * The advisor's Budget switch (`clients.portal_budget_enabled`). Default
   * true. Off skips every budgeting query — the section is gone from this
   * client's portal, and gated data must not reach the payload at all, only
   * to be hidden by the tile. Echoed back on the DTO so the mobile home
   * screen drops the same tiles the web dashboard does.
   */
  budgetEnabled?: boolean;
}

export async function loadPortalDashboard(
  clientId: string,
  now: Date,
  sharing: PortalPrivacy = DEFAULT_PORTAL_PRIVACY,
  { includeGoals = true, budgetEnabled = true }: LoadPortalDashboardOptions = {},
): Promise<PortalDashboardDTO> {
  // The advisor's Budget switch subsumes the client's three budgeting sharing
  // switches — everything they gate lives in the section it removes. The DTO
  // still reports the client's own `sharing`: the two say different things, and
  // a "you hid this from your advisor" notice would be the wrong one here.
  const share: PortalPrivacy = budgetEnabled
    ? sharing
    : { shareTransactions: false, shareBudgets: false, shareRecurrings: false };

  const today = now.toISOString().slice(0, 10);
  const { from, to } = currentMonthRange(now);
  const prior = priorMonthRange(now);
  const month = from.slice(0, 7);

  const [[scenario], [clientRow]] = await Promise.all([
    db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
      .limit(1),
    // The projection loader is firm-scoped; the portal gate hands us a client
    // id only, so resolve the owning firm here rather than widening the gate.
    db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1),
  ]);

  // Run the independent loaders/queries in parallel. Sections the client has
  // switched off for the advisor are never queried — the data must not reach
  // the RSC payload at all, not merely be hidden by the tile.
  const [
    budget,
    recurringsData,
    monthTxns,
    monthAgg,
    priorAgg,
    uncategorized,
    accountRows,
    goalFunding,
  ] = await Promise.all([
    share.shareBudgets
      ? loadBudgetSummary(clientId, now)
      : Promise.resolve(emptyBudget(month)),
    share.shareRecurrings
      ? loadRecurringsData(clientId, now)
      : Promise.resolve(null),
    // This month's expense txns (signed) for the pace curve. `categoryId` comes
    // along so the curve can drop budget-excluded categories below — the curve
    // is drawn against `budget.totalBudget`, so it has to count the same spend
    // the budget totals count or the "under by" read is wrong.
    share.shareTransactions
      ? db
          .select({
            date: plaidTransactions.date,
            amount: plaidTransactions.amount,
            categoryId: plaidTransactions.categoryId,
          })
          .from(plaidTransactions)
          .where(
            and(
              eq(plaidTransactions.clientId, clientId),
              eq(plaidTransactions.excluded, false),
              eq(plaidTransactions.type, "expense"),
              gte(plaidTransactions.date, from),
              lte(plaidTransactions.date, to),
            ),
          )
      : Promise.resolve([]),
    // Current-month income/spend raw posted totals for the net-this-month tile (like-for-like with priorAgg).
    share.shareTransactions
      ? db
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
          .groupBy(plaidTransactions.type)
      : Promise.resolve([]),
    // Prior-month income/spend totals for the net-this-month delta.
    share.shareTransactions
      ? db
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
          .groupBy(plaidTransactions.type)
      : Promise.resolve([]),
    // Uncategorized expense count + sample ("to review").
    share.shareTransactions
      ? db
          .select({
            id: plaidTransactions.id,
            date: plaidTransactions.date,
            name: plaidTransactions.name,
            merchantName: plaidTransactions.merchantName,
            amount: plaidTransactions.amount,
            accountName: accounts.name,
            categoryId: plaidTransactions.categoryId,
            categoryName: transactionCategories.name,
            categoryColor: transactionCategories.color,
          })
          .from(plaidTransactions)
          .leftJoin(accounts, eq(accounts.id, plaidTransactions.accountId))
          .leftJoin(
            transactionCategories,
            eq(transactionCategories.id, plaidTransactions.categoryId),
          )
          .where(
            and(
              eq(plaidTransactions.clientId, clientId),
              eq(plaidTransactions.excluded, false),
              ne(plaidTransactions.type, "transfer"),
              isNull(plaidTransactions.reviewedAt),
            ),
          )
          .orderBy(desc(plaidTransactions.date), desc(plaidTransactions.id))
          .limit(5)
      : Promise.resolve([]),
    // Visible asset accounts for net worth (base-case scenario).
    scenario
      ? db
          .select({
            id: accounts.id,
            name: accounts.name,
            category: accounts.category,
            value: accounts.value,
            isDefaultChecking: accounts.isDefaultChecking,
            parentAccountId: accounts.parentAccountId,
          })
          .from(accounts)
          .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id)))
      : Promise.resolve([]),
    // Goal funding runs the base-case projection. Not gated by a sharing
    // switch: the switches cover the client's Plaid data (transactions,
    // budgets, recurrings), and goals come from the advisor's own plan.
    includeGoals && clientRow?.firmId
      ? loadGoalFunding(clientId, clientRow.firmId)
      : Promise.resolve({ goals: [], projected: false }),
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
  // Reuse the rollup's own verdict on what is excluded rather than re-deriving
  // it in SQL: `budget.excluded` already resolves both the per-category flag and
  // the whole-group flag.
  const excludedCategoryIds = new Set(budget.excluded.map((c) => c.id));
  const pace = spendingPaceCurve({
    dailySpend: monthTxns
      .filter((t) => t.categoryId == null || !excludedCategoryIds.has(t.categoryId))
      .map((t) => ({ date: t.date, amount: Number(t.amount) })),
    totalBudget: budget.totalBudget,
    now,
  });

  // ---- To-review count (cheap COUNT alongside the sample) ----
  const countRows = share.shareTransactions
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(plaidTransactions)
        .where(
          and(
            eq(plaidTransactions.clientId, clientId),
            eq(plaidTransactions.excluded, false),
            ne(plaidTransactions.type, "transfer"),
            isNull(plaidTransactions.reviewedAt),
          ),
        )
    : [];
  const count = countRows[0]?.count ?? 0;

  const recurringRows = recurringsData?.recurrings ?? [];

  return {
    spending: {
      left: budget.totalRemaining,
      budgeted: budget.totalBudget,
      spent: budget.totalSpent,
      pace: pace.points,
      underBy: pace.underBy,
      month: budget.month,
      groups: budget.groups
        .filter((g) => g.actual > 0 || g.budget != null)
        .map((g) => ({ id: g.id, name: g.name, color: g.color, spent: g.actual, budget: g.budget })),
    },
    netWorth: {
      assets: nw.assets,
      debt: nw.debt,
      netWorth: nw.netWorth,
      series,
      asOfDate: today,
      accounts: visible
        .map((r) => ({ id: r.id, name: r.name, value: Number(r.value || "0") }))
        .sort((a, b) => b.value - a.value),
      debts: debtRows
        .map((d) => ({ id: d.id, name: d.name, value: d.balance }))
        .sort((a, b) => b.value - a.value),
      assetGroups: assetCategoryTotals(
        visible.map((r) => ({ category: r.category, value: Number(r.value || "0") })),
      ),
    },
    goals: goalFunding.goals,
    goalsProjected: goalFunding.projected,
    toReview: {
      count: count ?? 0,
      sample: uncategorized.map((t) => ({
        id: t.id,
        date: t.date,
        name: t.name,
        merchantName: t.merchantName,
        amount: Number(t.amount),
        accountName: t.accountName,
        categoryId: t.categoryId,
        categoryName: t.categoryName,
        categoryColor: t.categoryColor,
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
    recurrings: dueWithinDays(recurringRows, now, 14),
    recurringRows,
    sharing,
    budgetEnabled,
  };
}
