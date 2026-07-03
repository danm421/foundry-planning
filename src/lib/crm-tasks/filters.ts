export type TaskQuickFilter = "all" | "mine" | "open" | "overdue" | "done";

const QUICK_FILTER_VALUES: ReadonlyArray<TaskQuickFilter> = [
  "all",
  "mine",
  "open",
  "overdue",
  "done",
];

/** Parse a raw `?quick=` URL param; unknown or absent values become null (default preset). */
export function coerceQuickFilter(value: string | null | undefined): TaskQuickFilter | null {
  if (!value) return null;
  return QUICK_FILTER_VALUES.includes(value as TaskQuickFilter)
    ? (value as TaskQuickFilter)
    : null;
}

export type NormalizedTaskFilters = {
  status: ("open" | "in_progress" | "blocked" | "done")[] | null;
  overdueOnly: boolean;
  assigneeUserId: string | null;
};

/**
 * Resolve a quick-filter preset + optional explicit assignee into a single
 * normalized filter object. The UI passes both `quick` and `assignee` in
 * URL params; this function reconciles them.
 *
 * - `mine` forces `assignee` to the current user, overriding any explicit one.
 * - `overdue` sets `overdueOnly` and excludes done tasks.
 * - `done` shows only done tasks (otherwise done is hidden).
 */
export function normalizeQuickFilters(args: {
  quick: TaskQuickFilter | null;
  explicitAssignee: string | null;
  currentUserId: string;
}): NormalizedTaskFilters {
  const { quick, explicitAssignee, currentUserId } = args;
  if (quick === "overdue") {
    return {
      status: ["open", "in_progress", "blocked"],
      overdueOnly: true,
      assigneeUserId: explicitAssignee,
    };
  }
  if (quick === "done") {
    return {
      status: ["done"],
      overdueOnly: false,
      assigneeUserId: explicitAssignee,
    };
  }
  if (quick === "mine") {
    return {
      status: ["open", "in_progress", "blocked"],
      overdueOnly: false,
      assigneeUserId: currentUserId,
    };
  }
  if (quick === "open" || quick === null || quick === "all") {
    const status: NormalizedTaskFilters["status"] =
      quick === "all" ? null : ["open", "in_progress", "blocked"];
    return { status, overdueOnly: false, assigneeUserId: explicitAssignee };
  }
  // exhaustive guard
  const _exhaustive: never = quick;
  return _exhaustive;
}
