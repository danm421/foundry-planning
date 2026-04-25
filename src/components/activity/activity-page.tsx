import type { ReactElement } from "react";
import type {
  ActivityRow,
  ActivityCursor,
  ActivityFilters as Filters,
} from "@/lib/activity/list-client-activity";
import type { ActorDisplay } from "@/lib/activity/resolve-actors";
import ActivityFilterBar from "./activity-filters";
import ActivityFeed from "./activity-feed";

export type HydratedActivityRow = ActivityRow & { actor: ActorDisplay };

interface Props {
  clientId: string;
  filters: Filters;
  initialRows: HydratedActivityRow[];
  initialNextCursor: ActivityCursor | null;
}

export default function ActivityPage({
  clientId,
  filters,
  initialRows,
  initialNextCursor,
}: Props): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-ink">Activity</h1>
        <p className="text-sm text-ink-muted">All changes for this client.</p>
      </header>

      <ActivityFilterBar filters={filters} />

      <ActivityFeed
        clientId={clientId}
        filters={filters}
        initialRows={initialRows}
        initialNextCursor={initialNextCursor}
      />
    </div>
  );
}
