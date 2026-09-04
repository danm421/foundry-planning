"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

import {
  coerceQuickFilter,
  TASK_SCOPE_PARAMS,
  type TaskQuickFilter,
} from "@/lib/crm-tasks/filters";

interface ChipDef {
  value: TaskQuickFilter;
  label: string;
}

const CHIPS: ChipDef[] = [
  { value: "all", label: "All" },
  { value: "mine", label: "My tasks" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "done", label: "Done" },
];

/**
 * Scope-anchor params that must survive a chip click so nested views
 * (a specific household's tasks tab, a tag-scoped list, an explicit
 * assignee filter) don't lose their scope when the user toggles a quick
 * filter. `task` keeps an open side panel open across a chip click; the
 * copied `quick` is immediately overwritten with the clicked chip.
 */
const PRESERVED_PARAMS = [...TASK_SCOPE_PARAMS, "task"] as const;

/**
 * Renders the quick-filter chips above the task table. Client component —
 * writes `?quick=<value>` via `router.replace({ scroll: false })` so the
 * page re-renders with the new filter applied but doesn't jump scroll.
 */
export function CrmTaskFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // No `quick` param renders the same list as the "Open" preset (done
  // hidden), so highlight the Open chip on the default landing.
  const currentQuick = coerceQuickFilter(searchParams.get("quick")) ?? "open";

  function chipHref(value: TaskQuickFilter): string {
    const next = new URLSearchParams();
    for (const k of PRESERVED_PARAMS) {
      const v = searchParams.get(k);
      if (v) next.set(k, v);
    }
    next.set("quick", value);
    return `${pathname}?${next.toString()}`;
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>, value: TaskQuickFilter) {
    e.preventDefault();
    router.replace(chipHref(value), { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((chip) => {
        const isActive = chip.value === currentQuick;
        return (
          <button
            key={chip.label}
            type="button"
            onClick={(e) => onClick(e, chip.value)}
            aria-pressed={isActive}
            className={
              "rounded-[var(--radius-sm)] border px-3 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 " +
              (isActive
                ? "border-accent bg-accent text-accent-on"
                : "border-hair-2 text-ink-3 hover:border-hair-3 hover:bg-card-hover hover:text-ink-2")
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
