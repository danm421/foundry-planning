"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

import type { TaskQuickFilter } from "@/lib/crm-tasks/filters";

interface ChipDef {
  /** URL value. `null` means "no `quick` param" (i.e. default). */
  value: TaskQuickFilter | null;
  label: string;
}

const CHIPS: ChipDef[] = [
  { value: null, label: "All" },
  { value: "mine", label: "My tasks" },
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "done", label: "Done" },
];

/**
 * Scope-anchor params that must survive a chip click so nested views
 * (a specific household's tasks tab, a tag-scoped list) don't lose their
 * scope when the user toggles a quick filter.
 */
const PRESERVED_PARAMS = ["householdId", "tagId", "priority", "task"] as const;

/**
 * Renders the quick-filter chips above the task table. Client component —
 * writes `?quick=<value>` via `router.replace({ scroll: false })` so the
 * page re-renders with the new filter applied but doesn't jump scroll.
 */
export function CrmTaskFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuick = searchParams.get("quick");

  function chipHref(value: TaskQuickFilter | null): string {
    const next = new URLSearchParams();
    for (const k of PRESERVED_PARAMS) {
      const v = searchParams.get(k);
      if (v) next.set(k, v);
    }
    if (value) next.set("quick", value);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>, value: TaskQuickFilter | null) {
    e.preventDefault();
    router.replace(chipHref(value), { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((chip) => {
        const isActive = (chip.value ?? null) === (currentQuick ?? null);
        return (
          <button
            key={chip.label}
            type="button"
            onClick={(e) => onClick(e, chip.value)}
            aria-pressed={isActive}
            className={
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors " +
              (isActive
                ? "bg-accent text-accent-on"
                : "border border-hair text-ink-3 hover:bg-card-2 hover:text-ink-2")
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
