import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  crmHouseholds,
  crmTags,
  crmTaskActivity,
  crmTaskCommentMentions,
  crmTaskComments,
  crmTaskTags,
  crmTasks,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";

import { nextDueDate } from "./recurrence";
import type {
  CreateCrmTagInput,
  CreateCrmTaskInput,
  UpdateCrmTaskFieldInput,
} from "./schemas";

/**
 * Mutations module for CRM tasks. Mirrors the shape of
 * `src/lib/crm/households.ts` — small, focused functions that the route
 * handlers call. Each mutation wraps the table write + activity-feed
 * row in a single `db.transaction` so the audit trail can never get out
 * of sync with the underlying row. The firm-wide audit (SOC-2) is
 * written *outside* the transaction since `recordAudit` swallows its
 * own errors and we don't want a flaky audit insert rolling back the
 * caller's mutation.
 *
 * Validation failures throw plain `Error`s — the route handler is
 * responsible for translating those into 4xx responses.
 *
 * Callers pass `firmId` and `userId` explicitly; this module performs
 * no auth (it stays out of Clerk territory so it remains testable in
 * isolation).
 */

type CrmTaskStatus = "open" | "in_progress" | "blocked" | "done";

// --- helpers --------------------------------------------------------------

async function loadTaskOrThrow(taskId: string, firmId: string) {
  const task = await db.query.crmTasks.findFirst({
    where: and(eq(crmTasks.id, taskId), eq(crmTasks.firmId, firmId)),
  });
  if (!task) throw new Error("Task not found");
  return task;
}

async function assertHouseholdInFirm(householdId: string, firmId: string) {
  const household = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, householdId), eq(crmHouseholds.firmId, firmId)),
    columns: { id: true },
  });
  if (!household) throw new Error("Household not found in firm");
}

async function assertTagInFirm(tagId: string, firmId: string) {
  const tag = await db.query.crmTags.findFirst({
    where: and(eq(crmTags.id, tagId), eq(crmTags.firmId, firmId)),
    columns: { id: true },
  });
  if (!tag) throw new Error("Tag not found in firm");
}

// --- 1. createTask --------------------------------------------------------

export async function createTask(
  firmId: string,
  createdByUserId: string,
  input: CreateCrmTaskInput,
) {
  if (input.householdId) {
    await assertHouseholdInFirm(input.householdId, firmId);
  }

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(crmTasks)
      .values({
        firmId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        status: input.status,
        dueDate: input.dueDate ?? null,
        startDate: input.startDate ?? null,
        recurrence: input.recurrence,
        householdId: input.householdId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        createdByUserId,
      })
      .returning();

    await tx.insert(crmTaskActivity).values({
      taskId: row.id,
      userId: createdByUserId,
      kind: "created",
      payload: { title: row.title },
    });

    return row;
  });

  await recordAudit({
    action: "crm.task.create",
    resourceType: "crm_task",
    resourceId: created.id,
    firmId,
    metadata: { title: created.title, householdId: created.householdId },
  });

  return created;
}

// --- 2. updateTaskField ---------------------------------------------------

// Map each updatable field to the activity-kind we record. Keeps the
// switch below from sprouting a giant string literal per branch.
const FIELD_ACTIVITY_KIND: Record<
  UpdateCrmTaskFieldInput["field"],
  | "title_changed"
  | "description_changed"
  | "priority_changed"
  | "due_date_changed"
  | "start_date_changed"
  | "recurrence_changed"
  | "household_changed"
  | "assignee_changed"
> = {
  title: "title_changed",
  description: "description_changed",
  priority: "priority_changed",
  dueDate: "due_date_changed",
  startDate: "start_date_changed",
  recurrence: "recurrence_changed",
  householdId: "household_changed",
  assigneeUserId: "assignee_changed",
};

export async function updateTaskField(
  taskId: string,
  firmId: string,
  userId: string,
  update: UpdateCrmTaskFieldInput,
) {
  const existing = await loadTaskOrThrow(taskId, firmId);

  // Validate household ownership *before* opening the transaction so we
  // don't pay the bookkeeping cost for an invalid request.
  if (update.field === "householdId" && update.value !== null) {
    await assertHouseholdInFirm(update.value, firmId);
  }

  // Compute prior value (for activity payload) + the patch payload.
  let from: unknown;
  const patch: Partial<typeof crmTasks.$inferInsert> = { updatedAt: new Date() };

  switch (update.field) {
    case "title":
      from = existing.title;
      patch.title = update.value;
      break;
    case "description":
      from = existing.description;
      patch.description = update.value;
      break;
    case "priority":
      from = existing.priority;
      patch.priority = update.value;
      break;
    case "dueDate":
      from = existing.dueDate;
      patch.dueDate = update.value;
      break;
    case "startDate":
      from = existing.startDate;
      patch.startDate = update.value;
      break;
    case "recurrence":
      from = existing.recurrence;
      patch.recurrence = update.value;
      break;
    case "householdId":
      from = existing.householdId;
      patch.householdId = update.value;
      break;
    case "assigneeUserId":
      from = existing.assigneeUserId;
      patch.assigneeUserId = update.value;
      break;
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(crmTasks)
      .set(patch)
      .where(and(eq(crmTasks.id, taskId), eq(crmTasks.firmId, firmId)))
      .returning();

    await tx.insert(crmTaskActivity).values({
      taskId,
      userId,
      kind: FIELD_ACTIVITY_KIND[update.field],
      payload: { field: update.field, from, to: update.value },
    });

    return row;
  });

  await recordAudit({
    action: "crm.task.update",
    resourceType: "crm_task",
    resourceId: taskId,
    firmId,
    metadata: { field: update.field, from, to: update.value },
  });

  return updated;
}

// --- 3. deleteTask --------------------------------------------------------

export async function deleteTask(taskId: string, firmId: string) {
  // Confirm the row exists & belongs to the firm before deleting so we
  // surface a 404-ish error instead of a silent no-op.
  await loadTaskOrThrow(taskId, firmId);

  await db
    .delete(crmTasks)
    .where(and(eq(crmTasks.id, taskId), eq(crmTasks.firmId, firmId)));

  // No activity row — the task is gone; the audit log is the only
  // remaining trail.
  await recordAudit({
    action: "crm.task.delete",
    resourceType: "crm_task",
    resourceId: taskId,
    firmId,
  });
}

// --- 4. setTaskStatus -----------------------------------------------------

export async function setTaskStatus(
  taskId: string,
  firmId: string,
  userId: string,
  status: CrmTaskStatus,
): Promise<{ task: typeof crmTasks.$inferSelect; followOnId: string | null }> {
  const existing = await loadTaskOrThrow(taskId, firmId);
  const priorStatus = existing.status;
  const completing = status === "done" && priorStatus !== "done";
  const reopening = status !== "done" && priorStatus === "done";

  const activityKind: "completed" | "reopened" | "status_changed" = completing
    ? "completed"
    : reopening
      ? "reopened"
      : "status_changed";

  const result = await db.transaction(async (tx) => {
    const patch: Partial<typeof crmTasks.$inferInsert> = {
      status,
      updatedAt: new Date(),
    };
    if (completing) {
      patch.completedAt = new Date();
      patch.completedByUserId = userId;
    } else if (reopening) {
      patch.completedAt = null;
      patch.completedByUserId = null;
    }

    const [task] = await tx
      .update(crmTasks)
      .set(patch)
      .where(and(eq(crmTasks.id, taskId), eq(crmTasks.firmId, firmId)))
      .returning();

    await tx.insert(crmTaskActivity).values({
      taskId,
      userId,
      kind: activityKind,
      payload: { from: priorStatus, to: status },
    });

    // Spawn a follow-on task if completing a recurring task with a due date.
    let followOnId: string | null = null;
    if (
      completing &&
      existing.recurrence !== "none" &&
      existing.dueDate !== null
    ) {
      const nextDue = nextDueDate(existing.recurrence, existing.dueDate);
      if (nextDue !== null) {
        const [followOn] = await tx
          .insert(crmTasks)
          .values({
            firmId: existing.firmId,
            title: existing.title,
            description: existing.description,
            priority: existing.priority,
            status: "open",
            dueDate: nextDue,
            startDate: null,
            recurrence: existing.recurrence,
            householdId: existing.householdId,
            assigneeUserId: existing.assigneeUserId,
            createdByUserId: userId,
          })
          .returning({ id: crmTasks.id });
        followOnId = followOn.id;

        await tx.insert(crmTaskActivity).values({
          taskId: followOn.id,
          userId,
          kind: "created",
          payload: { title: existing.title, fromRecurrence: taskId },
        });
      }
    }

    return { task, followOnId };
  });

  await recordAudit({
    action: "crm.task.status_changed",
    resourceType: "crm_task",
    resourceId: taskId,
    firmId,
    metadata: {
      from: priorStatus,
      to: status,
      followOnId: result.followOnId,
    },
  });

  return result;
}

// --- 5. postComment -------------------------------------------------------

export async function postComment(
  taskId: string,
  firmId: string,
  authorUserId: string,
  body: string,
  /** Firm-validated Clerk user ids mentioned in `body` (route resolves these). */
  mentionedUserIds: string[] = [],
) {
  await loadTaskOrThrow(taskId, firmId);

  const created = await db.transaction(async (tx) => {
    const [comment] = await tx
      .insert(crmTaskComments)
      .values({
        taskId,
        authorUserId,
        bodyMarkdown: body,
      })
      .returning();

    await tx.insert(crmTaskActivity).values({
      taskId,
      userId: authorUserId,
      kind: "comment_posted",
      payload: { commentId: comment.id },
    });

    const mentions = [...new Set(mentionedUserIds)];
    if (mentions.length > 0) {
      await tx.insert(crmTaskCommentMentions).values(
        mentions.map((mentionedUserId) => ({
          commentId: comment.id,
          taskId,
          firmId,
          mentionedUserId,
        })),
      );
    }

    // Bump the parent task's updatedAt so list views surface recent
    // discussion without forcing a separate query.
    await tx
      .update(crmTasks)
      .set({ updatedAt: new Date() })
      .where(eq(crmTasks.id, taskId));

    return comment;
  });

  await recordAudit({
    action: "crm.task.comment",
    resourceType: "crm_task",
    resourceId: taskId,
    firmId,
    metadata: { commentId: created.id },
  });

  return created;
}

// --- 6. attachTag ---------------------------------------------------------

export async function attachTag(
  taskId: string,
  firmId: string,
  tagId: string,
  userId: string,
) {
  await loadTaskOrThrow(taskId, firmId);
  await assertTagInFirm(tagId, firmId);

  await db.transaction(async (tx) => {
    await tx
      .insert(crmTaskTags)
      .values({ taskId, tagId })
      .onConflictDoNothing();

    await tx.insert(crmTaskActivity).values({
      taskId,
      userId,
      kind: "tags_changed",
      payload: { action: "attach", tagId },
    });

    await tx
      .update(crmTasks)
      .set({ updatedAt: new Date() })
      .where(eq(crmTasks.id, taskId));
  });

  // No dedicated audit action for tag attach/detach — bucket under
  // crm.task.update so the resource history stays on one timeline.
  await recordAudit({
    action: "crm.task.update",
    resourceType: "crm_task",
    resourceId: taskId,
    firmId,
    metadata: { tagAction: "attach", tagId },
  });
}

// --- 7. detachTag ---------------------------------------------------------

export async function detachTag(
  taskId: string,
  firmId: string,
  tagId: string,
  userId: string,
) {
  await loadTaskOrThrow(taskId, firmId);

  await db.transaction(async (tx) => {
    await tx
      .delete(crmTaskTags)
      .where(
        and(eq(crmTaskTags.taskId, taskId), eq(crmTaskTags.tagId, tagId)),
      );

    await tx.insert(crmTaskActivity).values({
      taskId,
      userId,
      kind: "tags_changed",
      payload: { action: "detach", tagId },
    });

    await tx
      .update(crmTasks)
      .set({ updatedAt: new Date() })
      .where(eq(crmTasks.id, taskId));
  });

  await recordAudit({
    action: "crm.task.update",
    resourceType: "crm_task",
    resourceId: taskId,
    firmId,
    metadata: { tagAction: "detach", tagId },
  });
}

// --- 8. createTag ---------------------------------------------------------

export async function createTag(firmId: string, input: CreateCrmTagInput) {
  // `onConflictDoNothing` on the (firmId, label) unique index makes this
  // safely idempotent — if the tag already exists, return the existing
  // row so callers can treat create + reuse as a single operation.
  const inserted = await db
    .insert(crmTags)
    .values({
      firmId,
      label: input.label,
      color: input.color,
    })
    .onConflictDoNothing({ target: [crmTags.firmId, crmTags.label] })
    .returning();

  const tag =
    inserted[0] ??
    (await db.query.crmTags.findFirst({
      where: and(
        eq(crmTags.firmId, firmId),
        eq(crmTags.label, input.label),
      ),
    }));

  if (!tag) throw new Error("Failed to create or fetch tag");

  // Only audit on real inserts so noisy "tag already existed" calls
  // don't pollute the SOC-2 trail.
  if (inserted[0]) {
    await recordAudit({
      action: "crm.tag.create",
      resourceType: "crm_tag",
      resourceId: tag.id,
      firmId,
      metadata: { label: tag.label, color: tag.color },
    });
  }

  return tag;
}
