"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_DIR, type ClientSortKey, type SortDir } from "@/lib/crm/sort";

/**
 * Header-cell styling for the clients table. Exported because
 * `unified-clients-table.tsx` interleaves plain `<th>` cells with these sortable
 * ones in the SAME header row — two copies would let the row drift out of
 * alignment. Declared here rather than there to keep the import one-directional.
 */
export const TH = "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3";

interface ClientsSortHeaderProps {
  sortKey: ClientSortKey;
  /** Visible column label. */
  label: string;
  /**
   * Accessible name for the button. `aria-sort` conveys direction but has no
   * vocabulary for WHICH field is sorted, so "Sort by last name" goes here —
   * this is what keeps the visible label "Name" honest for screen readers.
   */
  srLabel: string;
  activeKey: ClientSortKey | null;
  activeDir: SortDir;
}

export function ClientsSortHeader({
  sortKey,
  label,
  srLabel,
  activeKey,
  activeDir,
}: ClientsSortHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isActive = activeKey === sortKey;
  const nextDir: SortDir = isActive
    ? activeDir === "asc"
      ? "desc"
      : "asc"
    : DEFAULT_DIR[sortKey];

  function onClick() {
    const params = new URLSearchParams(searchParams);
    params.set("sort", sortKey);
    params.set("dir", nextDir);
    // A new sort invalidates how far the user had paged; keeping a large take
    // across a re-sort would silently re-fetch hundreds of rows.
    params.delete("take");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <th
      className={TH}
      aria-sort={isActive ? (activeDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={srLabel}
        title={srLabel}
        className="inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink"
      >
        {label}
        <span aria-hidden="true" className={isActive ? "text-ink" : "text-ink-4"}>
          {isActive ? (activeDir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
