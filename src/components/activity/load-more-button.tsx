"use client";

import { useState } from "react";
import type { ActivityCursor, ActivityFilters } from "@/lib/activity/list-client-activity";
import type { HydratedActivityRow } from "./activity-page";

interface Props {
  clientId: string;
  filters: ActivityFilters;
  cursor: ActivityCursor;
  onLoaded: (rows: HydratedActivityRow[], next: ActivityCursor | null) => void;
  onError: (msg: string) => void;
}

export default function LoadMoreButton({
  clientId,
  filters,
  cursor,
  onLoaded,
  onError,
}: Props) {
  const [loading, setLoading] = useState(false);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (filters.actorId) sp.set("actor", filters.actorId);
      if (filters.resourceType) sp.set("entity", filters.resourceType);
      if (filters.actionKind) sp.set("kind", filters.actionKind);
      sp.set("range", filters.range);
      sp.set("cursorAt", new Date(cursor.createdAt).toISOString());
      sp.set("cursorId", cursor.id);

      const res = await fetch(`/api/clients/${clientId}/activity?${sp}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as {
        rows: Array<HydratedActivityRow & { createdAt: string }>;
        nextCursor: { createdAt: string; id: string } | null;
      };
      const rows: HydratedActivityRow[] = json.rows.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt),
      }));
      const next: ActivityCursor | null = json.nextCursor
        ? {
            createdAt: new Date(json.nextCursor.createdAt),
            id: json.nextCursor.id,
          }
        : null;
      onLoaded(rows, next);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className="self-center rounded-md border border-hair bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-card-hover disabled:opacity-50"
      onClick={load}
      disabled={loading}
    >
      {loading ? "Loading…" : "Load more"}
    </button>
  );
}
