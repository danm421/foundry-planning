"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ActivityFilters as Filters } from "@/lib/activity/list-client-activity";

interface Props {
  filters: Filters;
}

const ENTITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All entities" },
  { value: "account", label: "Accounts" },
  { value: "asset_transaction", label: "Asset transactions" },
  { value: "liability", label: "Liabilities" },
  { value: "extra_payment", label: "Extra payments" },
  { value: "transfer", label: "Transfers" },
  { value: "client", label: "Client" },
];

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All actions" },
  { value: "create", label: "Created" },
  { value: "update", label: "Edited" },
  { value: "delete", label: "Deleted" },
  { value: "other", label: "Other" },
];

const RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export default function ActivityFiltersComponent({ filters }: Props) {
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
      <select
        aria-label="Filter by entity type"
        className="rounded-md border border-hair bg-card px-3 py-1.5 text-sm text-ink"
        value={filters.resourceType ?? ""}
        onChange={(e) => setParam("entity", e.target.value || null)}
      >
        {ENTITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by action kind"
        className="rounded-md border border-hair bg-card px-3 py-1.5 text-sm text-ink"
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
        className="rounded-md border border-hair bg-card px-3 py-1.5 text-sm text-ink"
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
