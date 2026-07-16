import { and, eq, inArray, lte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholds,
  crmTasks,
  scenarios,
} from "@/db/schema";
import { AUM_ELIGIBLE_CATEGORIES } from "@/lib/accounts/aum";
import { toIsoDate } from "./dates";
import { OPEN_TASK_STATUSES, visibleHouseholdConditions } from "./scope";
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
    // Total book value: base-case accounts the advisor flagged as AUM, in the
    // billable categories only. No grouping — with the CRM fallback gone this
    // is a single firm-wide sum. Category is filtered as well as the flag so an
    // account flagged while taxable and later switched to real estate can't leak in.
    db
      .select({ total: sql<string>`coalesce(sum(${accounts.value}), 0)` })
      .from(accounts)
      .innerJoin(
        scenarios,
        and(eq(accounts.scenarioId, scenarios.id), eq(scenarios.isBaseCase, true)),
      )
      .innerJoin(clients, eq(accounts.clientId, clients.id))
      .innerJoin(crmHouseholds, eq(clients.crmHouseholdId, crmHouseholds.id))
      .where(
        and(
          ...hhConditions,
          eq(accounts.countsTowardAum, true),
          inArray(accounts.category, [...AUM_ELIGIBLE_CATEGORIES]),
        ),
      ),
    taskPromise,
  ]);

  // planningRows still feeds the separate "Planning clients" tile — it is not
  // part of the book-value sum.
  const planningHouseholdIds = new Set(planningRows.map((r) => r.householdId));
  const totalBookValue = Number(aumRows[0]?.total ?? 0);

  const byStatus = new Map(statusRows.map((r) => [r.status, r.count]));
  const tasksDueThisWeek = taskRows.reduce((sum, r) => sum + r.count, 0);
  const tasksDueThisWeekMine =
    taskRows.find((r) => r.assignee === userId)?.count ?? 0;

  return {
    totalBookValue,
    activeHouseholds: byStatus.get("active") ?? 0,
    prospectHouseholds: byStatus.get("prospect") ?? 0,
    planningClients: planningHouseholdIds.size,
    tasksDueThisWeek,
    tasksDueThisWeekMine,
  };
}
