import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
import { getCrmHousehold } from "@/lib/crm/households";
import { resolveActors } from "@/lib/activity/resolve-actors";
import {
  getTaskById,
  listFirmTags,
  listTaskActivity,
  listTaskComments,
  listTaskFiles,
  listTasks,
} from "@/lib/crm-tasks/queries";
import { normalizeQuickFilters } from "@/lib/crm-tasks/filters";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { requireOrgId } from "@/lib/db-helpers";

import { HouseholdDetail, type HouseholdDetailTasksBootstrap } from "./household-detail";
import type { TaskDetailBundle } from "@/app/(app)/tasks/_components/tasks-page";

export default async function CrmHouseholdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; task?: string }>;
}) {
  const { id } = await params;
  const { tab, task } = await searchParams;
  const household = await getCrmHousehold(id);
  if (!household) notFound();

  // Always load tasks-tab bootstrap so the tab switch is instant — these
  // queries are scoped to a single firm/household and stay cheap.
  const firmId = await requireOrgId();
  const { userId, orgRole } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const canManage = orgRole === "org:admin";

  const filters = normalizeQuickFilters({
    quick: null,
    explicitAssignee: null,
    currentUserId: userId,
  });

  const [
    advisorActors,
    initialRows,
    members,
    firmTags,
    households,
  ] = await Promise.all([
    resolveActors([household.advisorId]),
    listTasks(firmId, { householdId: id }, filters),
    listFirmMembers(firmId),
    listFirmTags(firmId),
    db
      .select({ id: crmHouseholds.id, name: crmHouseholds.name })
      .from(crmHouseholds)
      .where(and(eq(crmHouseholds.firmId, firmId), isNull(crmHouseholds.deletedAt)))
      .orderBy(crmHouseholds.name),
  ]);
  const advisorName = advisorActors.get(household.advisorId)?.name ?? household.advisorId;

  let initialTaskDetail: TaskDetailBundle | null = null;
  if (task) {
    const found = await getTaskById(task, firmId);
    if (found) {
      const [comments, activityRows, files] = await Promise.all([
        listTaskComments(task),
        listTaskActivity(task),
        listTaskFiles(task),
      ]);
      const actorIds = Array.from(new Set(activityRows.map((r) => r.userId)));
      const actors = await resolveActors(actorIds);
      const activity = activityRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: actors.get(row.userId)?.name ?? row.userId,
        kind: row.kind,
        payload: (row.payload ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt.toISOString(),
      }));
      initialTaskDetail = {
        task: {
          id: found.task.id,
          title: found.task.title,
          status: found.task.status,
          priority: found.task.priority,
          dueDate: found.task.dueDate,
          startDate: found.task.startDate,
          recurrence: found.task.recurrence,
          householdId: found.task.householdId,
          assigneeUserId: found.task.assigneeUserId,
          description: found.task.description,
          createdAt: found.task.createdAt.toISOString(),
          createdByUserId: found.task.createdByUserId,
        },
        tags: found.tags,
        comments: comments.map((c) => ({
          id: c.id,
          authorUserId: c.authorUserId,
          bodyMarkdown: c.bodyMarkdown,
          createdAt: c.createdAt.toISOString(),
        })),
        activity,
        files: files.map((f) => ({
          id: f.id,
          taskId: f.taskId,
          uploadedByUserId: f.uploadedByUserId,
          filename: f.filename,
          storageProvider: f.storageProvider,
          storageKey: f.storageKey,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          uploadedAt: f.uploadedAt.toISOString(),
        })),
      };
    }
  }

  const tasksBootstrap: HouseholdDetailTasksBootstrap = {
    initialRows,
    members,
    firmTags,
    households,
    initialTaskDetail,
  };

  return (
    <HouseholdDetail
      household={household}
      advisorName={advisorName}
      initialTab={tab ?? "overview"}
      initialTaskId={task}
      tasksBootstrap={tasksBootstrap}
      canManage={canManage}
    />
  );
}
