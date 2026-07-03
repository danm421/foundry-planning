import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
import { resolveActors } from "@/lib/activity/resolve-actors";
import {
  getTaskById,
  listFirmTags,
  listTaskActivity,
  listTaskComments,
  listTaskFiles,
  listTasks,
} from "@/lib/crm-tasks/queries";
import { coerceQuickFilter, normalizeQuickFilters } from "@/lib/crm-tasks/filters";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { requireOrgId } from "@/lib/db-helpers";

import { TasksPage, type TaskDetailBundle } from "./_components/tasks-page";

function coercePriority(value: string | undefined): "low" | "med" | "high" | undefined {
  if (value === "low" || value === "med" || value === "high") return value;
  return undefined;
}

export default async function TasksRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const firmId = await requireOrgId();
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const filters = normalizeQuickFilters({
    quick: coerceQuickFilter(sp.quick),
    explicitAssignee: sp.assignee ?? null,
    currentUserId: userId,
  });

  const [initialRows, members, firmTags, households] = await Promise.all([
    listTasks(
      firmId,
      { tagId: sp.tagId, priority: coercePriority(sp.priority) },
      filters,
    ),
    listFirmMembers(firmId),
    listFirmTags(firmId),
    db
      .select({ id: crmHouseholds.id, name: crmHouseholds.name })
      .from(crmHouseholds)
      .where(and(eq(crmHouseholds.firmId, firmId), isNull(crmHouseholds.deletedAt)))
      .orderBy(crmHouseholds.name),
  ]);

  // Pre-load the side panel bundle server-side when the URL has `?task=`.
  // The client `TasksPage` will fall back to fetching via the REST API if
  // we don't pass one in (e.g. when the user opens a task by clicking a
  // row after the initial render).
  let initialTaskDetail: TaskDetailBundle | null = null;
  if (sp.task) {
    const found = await getTaskById(sp.task, firmId);
    if (found) {
      const [comments, activityRows, files] = await Promise.all([
        listTaskComments(sp.task),
        listTaskActivity(sp.task),
        listTaskFiles(sp.task),
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

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-ink">Tasks</h1>
      <div className="mt-6">
        <TasksPage
          initialRows={initialRows}
          initialTaskId={sp.task}
          members={members}
          households={households}
          firmTags={firmTags}
          initialTaskDetail={initialTaskDetail}
        />
      </div>
    </div>
  );
}
