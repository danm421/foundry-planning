"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { FirmMember } from "@/lib/crm-tasks/members";

import { CrmTaskFilters } from "@/components/crm-task-filters";
import { CrmTaskTable } from "@/components/crm-task-table";
import { NewCrmTaskDialog } from "@/components/new-crm-task-dialog";
import {
  CrmTaskSidePanel,
  type CrmTaskSidePanelTask,
} from "@/components/crm-task-side-panel";
import { CrmTaskSidePanelDetails } from "@/components/crm-task-side-panel-details";
import {
  CrmTaskSidePanelComments,
  type CrmTaskComment,
} from "@/components/crm-task-side-panel-comments";
import {
  CrmTaskSidePanelActivity,
  type CrmTaskActivityRow,
} from "@/components/crm-task-side-panel-activity";
import {
  CrmTaskSidePanelFiles,
  type TaskFileRow,
} from "@/components/crm-task-side-panel-files";
import { Skeleton, SkeletonText } from "@/components/skeleton/skeleton";

export interface TaskDetailBundle {
  task: {
    id: string;
    title: string;
    status: "open" | "in_progress" | "blocked" | "done";
    priority: "low" | "med" | "high";
    dueDate: string | null;
    startDate: string | null;
    recurrence: "none" | "weekly" | "monthly" | "quarterly";
    householdId: string | null;
    assigneeUserId: string | null;
    description: string;
    createdAt: string;
    createdByUserId: string;
  };
  tags: { id: string; label: string; color: string }[];
  comments: CrmTaskComment[];
  activity: CrmTaskActivityRow[];
  files: TaskFileRow[];
}

export interface TasksPageProps {
  initialRows: TaskListRow[];
  initialTaskId?: string;
  scopeHouseholdId?: string;
  members: FirmMember[];
  households: { id: string; name: string }[];
  firmTags: { id: string; label: string; color: string }[];
  initialTaskDetail?: TaskDetailBundle | null;
}

/**
 * Shared client component mounted by both the standalone `/tasks` page and
 * the household-detail Tasks tab. Renders the filter chips, "New task"
 * action, task table, and (when `?task=` is set in the URL) the side
 * panel. Initial rows + members + households come in as props; the side
 * panel detail bundle is loaded on the server when the URL already had
 * `?task=` at request time, otherwise it is fetched on the client when the
 * user clicks a row.
 */
export function TasksPage({
  initialRows,
  initialTaskId,
  scopeHouseholdId,
  members,
  households,
  firmTags,
  initialTaskDetail,
}: TasksPageProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTaskId = searchParams.get("task") ?? null;

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [detail, setDetail] = useState<TaskDetailBundle | null>(
    initialTaskId && initialTaskDetail && initialTaskDetail.task.id === initialTaskId
      ? initialTaskDetail
      : null,
  );
  const [detailError, setDetailError] = useState<string | null>(null);

  // Build the per-row deep-link prefix. Preserves the `tab=tasks` anchor
  // when this page is mounted inside the household-detail Tasks tab so
  // the back button lands the user back in the same tab.
  const hrefBase = useMemo(() => {
    if (scopeHouseholdId) {
      return `/crm/households/${scopeHouseholdId}?tab=tasks`;
    }
    return pathname || "/tasks";
  }, [pathname, scopeHouseholdId]);

  // When `?task=` changes, fetch the detail bundle. Bails out fast when
  // the active task already matches loaded detail (e.g. on first render
  // with a server-loaded bundle).
  useEffect(() => {
    if (!activeTaskId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    if (detail && detail.task.id === activeTaskId) return;

    let cancelled = false;
    setDetailError(null);

    (async () => {
      try {
        const [taskRes, commentsRes, activityRes, filesRes] = await Promise.all([
          fetch(`/api/crm/tasks/${activeTaskId}`, { cache: "no-store" }),
          fetch(`/api/crm/tasks/${activeTaskId}/comments`, { cache: "no-store" }),
          fetch(`/api/crm/tasks/${activeTaskId}/activity`, { cache: "no-store" }),
          fetch(`/api/crm/tasks/${activeTaskId}/files`, { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (!taskRes.ok) throw new Error(`Task fetch failed (${taskRes.status})`);
        if (!commentsRes.ok) throw new Error(`Comments fetch failed (${commentsRes.status})`);
        if (!activityRes.ok) throw new Error(`Activity fetch failed (${activityRes.status})`);
        if (!filesRes.ok) throw new Error(`Files fetch failed (${filesRes.status})`);

        const taskJson = await taskRes.json();
        const commentsJson = await commentsRes.json();
        const activityJson = await activityRes.json();
        const filesJson = await filesRes.json();

        const bundle: TaskDetailBundle = {
          task: taskJson.task,
          tags: taskJson.tags ?? [],
          comments: commentsJson.comments ?? [],
          activity: activityJson.activity ?? [],
          files: filesJson.files ?? [],
        };
        if (!cancelled) setDetail(bundle);
      } catch (err) {
        if (cancelled) return;
        setDetailError(err instanceof Error ? err.message : "Failed to load task");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTaskId, detail]);

  const scopedHouseholdName = scopeHouseholdId
    ? households.find((h) => h.id === scopeHouseholdId)?.name
    : undefined;

  // Open the panel as soon as the URL has a task — even before the detail
  // bundle has loaded. We paint the chrome from the matching list row
  // (which we already have on the client) and show skeleton tab bodies
  // while the four detail fetches run. As soon as `detail` lands we swap
  // to the real bodies in-place without remounting the panel.
  const detailMatches = !!(detail && detail.task.id === activeTaskId);
  const optimisticRow = useMemo(
    () => (activeTaskId ? initialRows.find((r) => r.id === activeTaskId) ?? null : null),
    [activeTaskId, initialRows],
  );

  const sidePanelInitialTask: CrmTaskSidePanelTask | null = detailMatches
    ? {
        id: detail!.task.id,
        title: detail!.task.title,
        status: detail!.task.status,
        priority: detail!.task.priority,
      }
    : optimisticRow
      ? {
          id: optimisticRow.id,
          title: optimisticRow.title,
          status: optimisticRow.status,
          priority: optimisticRow.priority,
        }
      : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CrmTaskFilters />
        <button
          type="button"
          onClick={() => setNewTaskOpen(true)}
          className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-accent px-3 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink"
        >
          + New task
        </button>
      </div>

      <CrmTaskTable rows={initialRows} hrefBase={hrefBase} />

      {detailError && activeTaskId && (
        <div
          role="alert"
          className="mt-4 rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-4 py-2 text-[13px] text-crit"
        >
          {detailError}
        </div>
      )}

      {newTaskOpen && (
        <NewCrmTaskDialog
          open={newTaskOpen}
          onOpenChange={setNewTaskOpen}
          members={members}
          householdId={scopeHouseholdId}
          householdName={scopedHouseholdName}
        />
      )}

      {activeTaskId && sidePanelInitialTask && (
        <CrmTaskSidePanel
          key={activeTaskId}
          taskId={activeTaskId}
          initialTask={sidePanelInitialTask}
          detailsTab={
            detailMatches ? (
              <CrmTaskSidePanelDetails
                taskId={detail!.task.id}
                initial={{
                  status: detail!.task.status,
                  priority: detail!.task.priority,
                  dueDate: detail!.task.dueDate,
                  startDate: detail!.task.startDate,
                  recurrence: detail!.task.recurrence,
                  householdId: detail!.task.householdId,
                  assigneeUserId: detail!.task.assigneeUserId,
                  description: detail!.task.description,
                  createdAt: detail!.task.createdAt,
                  createdByUserId: detail!.task.createdByUserId,
                }}
                members={members}
                households={households}
                firmTags={firmTags}
                initialTags={detail!.tags}
              />
            ) : (
              <PanelBodySkeleton variant="details" />
            )
          }
          commentsTab={
            detailMatches ? (
              <CrmTaskSidePanelComments
                taskId={detail!.task.id}
                initialComments={detail!.comments}
              />
            ) : (
              <PanelBodySkeleton variant="list" />
            )
          }
          activityTab={
            detailMatches ? (
              <CrmTaskSidePanelActivity rows={detail!.activity} />
            ) : (
              <PanelBodySkeleton variant="list" />
            )
          }
          filesTab={
            detailMatches ? (
              <CrmTaskSidePanelFiles
                taskId={detail!.task.id}
                initialFiles={detail!.files}
              />
            ) : (
              <PanelBodySkeleton variant="list" />
            )
          }
        />
      )}
    </>
  );
}

function PanelBodySkeleton({ variant }: { variant: "details" | "list" }) {
  if (variant === "details") {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton height="0.75rem" width="30%" />
            <Skeleton height="2.25rem" className="w-full" />
          </div>
        ))}
        <div className="mt-2">
          <SkeletonText lines={3} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3"
        >
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}
