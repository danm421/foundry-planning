"use client";

import { useState } from "react";
import type { ActivityCursor, ActivityFilters } from "@/lib/activity/list-client-activity";
import type { HydratedActivityRow } from "./activity-page";
import ActivityRow from "./activity-row";
import LoadMoreButton from "./load-more-button";

interface Props {
  clientId: string;
  filters: ActivityFilters;
  initialRows: HydratedActivityRow[];
  initialNextCursor: ActivityCursor | null;
}

export default function ActivityFeed({
  clientId,
  filters,
  initialRows,
  initialNextCursor,
}: Props) {
  const [rows, setRows] = useState<HydratedActivityRow[]>(initialRows);
  const [cursor, setCursor] = useState<ActivityCursor | null>(initialNextCursor);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        No activity matches these filters.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div role="alert" className="text-sm text-crit">
          {error}
        </div>
      )}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <ActivityRow key={row.id} row={row} />
        ))}
      </ul>
      {cursor && (
        <LoadMoreButton
          clientId={clientId}
          filters={filters}
          cursor={cursor}
          onLoaded={(newRows, newCursor) => {
            setRows((prev) => [...prev, ...newRows]);
            setCursor(newCursor);
            setError(null);
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}
