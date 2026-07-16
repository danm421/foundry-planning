import { and, eq, inArray, lte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholdAccounts,
  crmHouseholds,
  crmTasks,
  scenarios,
} from "@/db/schema";
import { toIsoDate } from "./dates";
import { OPEN_TASK_STATUSES, visibleHouseholdConditions } from "./scope";
import type { BookKpis } from "./types";

/**
 * Hybrid AUM: households WITH a planning client count only their base-case
 * planning accounts (0 if none); households WITHOUT one fall back to their
 * CRM account balances. Never both.
 */
export function mergeAum(
  planningHouseholdIds: Set<string>,
  planningSums: Map<string, number>,
  crmSums: Map<string, number>,
): number {
  let total = 0;
  for (const v of planningSums.values()) total += v;
  for (const [householdId, v] of crmSums) {
    if (!planningHouseholdIds.has(householdId)) total += v;
  }
  return total;
}

export async function getBookKpis(
  firmId: string,
  userId: string,
  orgRole: string | null | undefined,
  today: Date,
): Promise<BookKpis> {
  const hhConditions = await visibleHouseholdConditions(firmId, userId, orgRole);

  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);

  const [statusRows, planningRows, planningSumRows, crmSumRows, taskRows] =
    await Promise.all([
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
      db
        .select({
          householdId: clients.crmHouseholdId,
          total: sql<string>`coalesce(sum(${accounts.value}), 0)`,
        })
        .from(accounts)
        .innerJoin(
          scenarios,
          and(eq(accounts.scenarioId, scenarios.id), eq(scenarios.isBaseCase, true)),
        )
        .innerJoin(clients, eq(accounts.clientId, clients.id))
        .innerJoin(crmHouseholds, eq(clients.crmHouseholdId, crmHouseholds.id))
        .where(and(...hhConditions))
        .groupBy(clients.crmHouseholdId),
      db
        .select({
          householdId: crmHouseholdAccounts.householdId,
          total: sql<string>`coalesce(sum(${crmHouseholdAccounts.balance}), 0)`,
        })
        .from(crmHouseholdAccounts)
        .innerJoin(crmHouseholds, eq(crmHouseholdAccounts.householdId, crmHouseholds.id))
        .where(and(...hhConditions))
        .groupBy(crmHouseholdAccounts.householdId),
      db
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
        .groupBy(crmTasks.assigneeUserId),
    ]);

  const planningHouseholdIds = new Set(planningRows.map((r) => r.householdId));
  const totalBookValue = mergeAum(
    planningHouseholdIds,
    new Map(planningSumRows.map((r) => [r.householdId, Number(r.total)])),
    new Map(crmSumRows.map((r) => [r.householdId, Number(r.total)])),
  );

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
