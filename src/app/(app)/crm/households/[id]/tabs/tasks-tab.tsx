"use client";

import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { FirmMember } from "@/lib/crm-tasks/members";

import {
  TasksPage,
  type TaskDetailBundle,
} from "@/app/(app)/tasks/_components/tasks-page";

interface TasksTabProps {
  household: { id: string; name: string };
  initialTaskId?: string;
  initialRows: TaskListRow[];
  members: FirmMember[];
  firmTags: { id: string; label: string; color: string }[];
  households: { id: string; name: string }[];
  initialTaskDetail?: TaskDetailBundle | null;
}

/**
 * Household-scoped wrapper around the shared `<TasksPage>` client
 * component. The parent `<HouseholdDetail>` is a client component, so we
 * receive all server-loaded data via props — the page-level `page.tsx`
 * does the SSR fetch and threads it through.
 *
 * The standalone `/tasks` route uses the same `<TasksPage>` but does its
 * own data loading; both surfaces converge on the same UI from here on.
 */
export function TasksTab({
  household,
  initialTaskId,
  initialRows,
  members,
  firmTags,
  households,
  initialTaskDetail,
}: TasksTabProps) {
  return (
    <TasksPage
      initialRows={initialRows}
      initialTaskId={initialTaskId}
      scopeHouseholdId={household.id}
      members={members}
      households={households}
      firmTags={firmTags}
      initialTaskDetail={initialTaskDetail}
    />
  );
}
