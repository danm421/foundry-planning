import { db } from "@/db";
import {
  crmTasks, crmTags, crmTaskTags, crmTaskComments,
  crmTaskActivity, crmTaskFiles, crmHouseholds,
} from "@/db/schema";
import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { visibleTaskCondition } from "@/lib/visibility";
import type { NormalizedTaskFilters } from "./filters";

/** Who is reading tasks; the CRM task rule (`visibleTaskCondition`) runs for them. */
export type TaskViewer = { userId: string; orgRole: string | null | undefined };

/**
 * Which tasks a read may return: those a viewer may see under the CRM task
 * rule, or — for a caller that already authorized a household — that
 * household's tasks only (all of them are visible to whoever may see it).
 */
export type TaskAccess = TaskViewer | { householdId: string };

async function accessCondition(firmId: string, access: TaskAccess): Promise<SQL | undefined> {
  return "householdId" in access
    ? eq(crmTasks.householdId, access.householdId)
    : visibleTaskCondition(firmId, access.userId, access.orgRole);
}

export type TaskListRow = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "done";
  priority: "low" | "med" | "high";
  dueDate: string | null;
  householdId: string | null;
  householdName: string | null;
  assigneeUserId: string | null;
  recurrence: "none" | "weekly" | "monthly" | "quarterly";
  commentCount: number;
  fileCount: number;
};

export async function listTasks(
  firmId: string,
  access: TaskAccess,
  scope: { householdId?: string; tagId?: string; priority?: "low" | "med" | "high" },
  filters: NormalizedTaskFilters,
): Promise<TaskListRow[]> {
  const conds = [eq(crmTasks.firmId, firmId), await accessCondition(firmId, access)];
  if (scope.householdId) conds.push(eq(crmTasks.householdId, scope.householdId));
  if (scope.priority) conds.push(eq(crmTasks.priority, scope.priority));
  if (filters.assigneeUserId) conds.push(eq(crmTasks.assigneeUserId, filters.assigneeUserId));
  if (filters.status) conds.push(inArray(crmTasks.status, filters.status));
  if (filters.overdueOnly) {
    conds.push(sql`${crmTasks.dueDate} < CURRENT_DATE`);
    conds.push(ne(crmTasks.status, "done"));
  }

  const rows = await db
    .select({
      id: crmTasks.id,
      title: crmTasks.title,
      status: crmTasks.status,
      priority: crmTasks.priority,
      dueDate: crmTasks.dueDate,
      householdId: crmTasks.householdId,
      householdName: crmHouseholds.name,
      assigneeUserId: crmTasks.assigneeUserId,
      recurrence: crmTasks.recurrence,
      commentCount: sql<number>`(SELECT COUNT(*)::int FROM ${crmTaskComments} WHERE ${crmTaskComments.taskId} = ${crmTasks.id})`,
      fileCount: sql<number>`(SELECT COUNT(*)::int FROM ${crmTaskFiles} WHERE ${crmTaskFiles.taskId} = ${crmTasks.id})`,
    })
    .from(crmTasks)
    .leftJoin(crmHouseholds, eq(crmHouseholds.id, crmTasks.householdId))
    .where(and(...conds))
    .orderBy(desc(crmTasks.createdAt));

  if (scope.tagId) {
    const tagged = await db
      .select({ taskId: crmTaskTags.taskId })
      .from(crmTaskTags)
      .where(eq(crmTaskTags.tagId, scope.tagId));
    const allowed = new Set(tagged.map((t) => t.taskId));
    return rows.filter((r) => allowed.has(r.id));
  }
  return rows;
}

/** The task, or null when it is missing, in another firm, or outside `access`. */
export async function findVisibleTask(taskId: string, firmId: string, access: TaskAccess) {
  const [task] = await db
    .select()
    .from(crmTasks)
    .where(
      and(eq(crmTasks.id, taskId), eq(crmTasks.firmId, firmId), await accessCondition(firmId, access)),
    )
    .limit(1);
  return task ?? null;
}

export async function getTaskById(taskId: string, firmId: string, access: TaskAccess) {
  const task = await findVisibleTask(taskId, firmId, access);
  if (!task) return null;
  const tags = await db
    .select({ id: crmTags.id, label: crmTags.label, color: crmTags.color })
    .from(crmTaskTags)
    .innerJoin(crmTags, eq(crmTags.id, crmTaskTags.tagId))
    .where(eq(crmTaskTags.taskId, taskId));
  return { task, tags };
}

export async function listTaskComments(taskId: string) {
  return db.select().from(crmTaskComments)
    .where(eq(crmTaskComments.taskId, taskId))
    .orderBy(crmTaskComments.createdAt);
}

export async function listTaskActivity(taskId: string) {
  return db.select().from(crmTaskActivity)
    .where(eq(crmTaskActivity.taskId, taskId))
    .orderBy(desc(crmTaskActivity.createdAt));
}

export async function listTaskFiles(taskId: string) {
  return db.select().from(crmTaskFiles)
    .where(eq(crmTaskFiles.taskId, taskId))
    .orderBy(desc(crmTaskFiles.uploadedAt));
}

export async function listFirmTags(firmId: string) {
  return db.select().from(crmTags).where(eq(crmTags.firmId, firmId)).orderBy(crmTags.label);
}
