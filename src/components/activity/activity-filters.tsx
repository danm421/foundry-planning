"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ActivityFilters as Filters } from "@/lib/activity/list-client-activity";
import type { FilterOption } from "./activity-page";

interface Props {
  filters: Filters;
  entityOptions: FilterOption[];
  actorOptions: FilterOption[];
}

const KIND_OPTIONS: FilterOption[] = [
  { value: "", label: "All actions" },
  { value: "create", label: "Created" },
  { value: "update", label: "Edited" },
  { value: "delete", label: "Deleted" },
  { value: "other", label: "Other" },
];

const RANGE_OPTIONS: FilterOption[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const selectClass =
  "rounded-md border border-hair bg-card px-3 py-1.5 text-sm text-ink";

export default function ActivityFiltersComponent({
  filters,
  entityOptions,
  actorOptions,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setParam(key: string, value: string | null): void {
    const next = new URLSearchParams(sp.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  }

  function reset(): void {
    router.replace(pathname);
  }

  const hasFilters =
    Boolean(filters.actorId) ||
    Boolean(filters.resourceType) ||
    Boolean(filters.actionKind) ||
    filters.range !== "90d";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actorOptions.length > 1 && (
        <select
          aria-label="Filter by person"
          className={selectClass}
          value={filters.actorId ?? ""}
          onChange={(e) => setParam("actor", e.target.value || null)}
        >
          <option value="">Everyone</option>
          {actorOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      <select
        aria-label="Filter by entity type"
        className={selectClass}
        value={filters.resourceType ?? ""}
        onChange={(e) => setParam("entity", e.target.value || null)}
      >
        <option value="">All entities</option>
        {entityOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by action kind"
        className={selectClass}
        value={filters.actionKind ?? ""}
        onChange={(e) => setParam("kind", e.target.value || null)}
      >
        {KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by date range"
        className={selectClass}
        value={filters.range}
        onChange={(e) => setParam("range", e.target.value)}
      >
        {RANGE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {hasFilters && (
        <button
          type="button"
          className="text-sm text-ink-3 underline-offset-2 hover:underline"
          onClick={reset}
        >
          Reset
        </button>
      )}
    </div>
  );
}
