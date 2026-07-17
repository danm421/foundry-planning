import { and, eq, inArray, lte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholds,
  crmTasks,
  scenarios,
} from "@/db/schema";
import { toIsoDate } from "./dates";
import { OPEN_TASK_STATUSES, aumBookWhere, visibleHouseholdConditions } from "./scope";
import type { BookKpis } from "./types";

async function fetchOpenTaskCounts(firmId: string, weekEnd: Date) {
  return await db
    .select({
      assignee: crmTasks.assigneeUserId,
      count: sql<number>`count(*)::int`,
    })
    .from(crmTasks)
    .where(
      and(
        eq(crmTasks.firmId, firmId),
        inArray(crmTasks.status, [...OPEN_TASK_STATUSES]),
        isNotNull(crmTasks.dueDate),
        lte(crmTasks.dueDate, toIsoDate(weekEnd)),
      ),
    )
    .groupBy(crmTasks.assigneeUserId);
}

export async function getBookKpis(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
  today: Date,
): Promise<BookKpis> {
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);

  // Task query doesn't depend on household visibility, so start it before
  // awaiting the shared conditions (mirrors getHomeFeed's conditionsPromise pattern).
  const conditionsPromise = visibleHouseholdConditions(firmId, userId, orgRole);
  const taskPromise = fetchOpenTaskCounts(firmId, weekEnd);

  const hhConditions = await conditionsPromise;

  const [statusRows, planningRows, aumRows, taskRows] = await Promise.all([
    db
      .select({ status: crmHouseholds.status, count: sql<number>`count(*)::int` })
      .from(crmHouseholds)
      .where(and(...hhConditions))
      .groupBy(crmHouseholds.status),
    db
      .select({ householdId: clients.crmHouseholdId })
      .from(clients)
      .innerJoin(crmHouseholds, eq(clients.crmHouseholdId, crmHouseholds.id))
      .where(and(...hhConditions)),
    // Book split: base-case accounts in the billable categories, split by the
    // advisor's counts_toward_aum flag. One round trip, two sums + a count.
    //
    // Category is filtered in WHERE, NOT in the FILTER clauses, so it guards
    // BOTH sides: held-away must mean "eligible but unflagged", never
    // "everything unflagged" (or real estate floods the tile). The form's
    // category guard is client-side only, so an account flagged while taxable
    // and later switched to real estate would otherwise leak into book value.
    db
      .select({
        aum: sql<string>`coalesce(sum(${accounts.value}) filter (where ${accounts.countsTowardAum}), 0)`,
        heldAway: sql<string>`coalesce(sum(${accounts.value}) filter (where not ${accounts.countsTowardAum}), 0)`,
        heldAwayAccounts: sql<number>`count(*) filter (where not ${accounts.countsTowardAum})::int`,
      })
      .from(accounts)
      .innerJoin(
        scenarios,
        and(eq(accounts.scenarioId, scenarios.id), eq(scenarios.isBaseCase, true)),
      )
      .innerJoin(clients, eq(accounts.clientId, clients.id))
      .innerJoin(crmHouseholds, eq(clients.crmHouseholdId, crmHouseholds.id))
      .where(aumBookWhere(hhConditions)),
    taskPromise,
  ]);

  // planningRows still feeds the separate "Planning clients" tile — it is not
  // part of the book-value sum.
  const planningHouseholdIds = new Set(planningRows.map((r) => r.householdId));
  const totalBookValue = Number(aumRows[0]?.aum ?? 0);
  const assetsHeldAway = Number(aumRows[0]?.heldAway ?? 0);
  const heldAwayAccounts = aumRows[0]?.heldAwayAccounts ?? 0;

  const byStatus = new Map(statusRows.map((r) => [r.status, r.count]));
  const tasksDueThisWeek = taskRows.reduce((sum, r) => sum + r.count, 0);
  const tasksDueThisWeekMine =
    taskRows.find((r) => r.assignee === userId)?.count ?? 0;

  return {
    totalBookValue,
    assetsHeldAway,
    heldAwayAccounts,
    activeHouseholds: byStatus.get("active") ?? 0,
    prospectHouseholds: byStatus.get("prospect") ?? 0,
    planningClients: planningHouseholdIds.size,
    tasksDueThisWeek,
    tasksDueThisWeekMine,
  };
}
