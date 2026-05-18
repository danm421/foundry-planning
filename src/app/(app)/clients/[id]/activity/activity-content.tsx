import type { ReactElement } from "react";
import {
  listClientActivity,
  type ActionKind,
  type DateRange,
} from "@/lib/activity/list-client-activity";
import { resolveActors } from "@/lib/activity/resolve-actors";
import ActivityPage from "@/components/activity/activity-page";

interface Props {
  clientId: string;
  firmId: string;
  actorId: string | null;
  resourceType: string | null;
  actionKind: ActionKind | null;
  range: DateRange;
}

export async function ActivityContent({
  clientId,
  firmId,
  actorId,
  resourceType,
  actionKind,
  range,
}: Props): Promise<ReactElement> {
  const filters = { actorId, resourceType, actionKind, range };

  const { rows, nextCursor } = await listClientActivity({
    clientId,
    firmId,
    filters,
    cursor: null,
    limit: 50,
  });

  const actorMap = await resolveActors(rows.map((r) => r.actorId));

  return (
    <ActivityPage
      clientId={clientId}
      filters={filters}
      initialRows={rows.map((r) => ({
        ...r,
        actor: actorMap.get(r.actorId) ?? { name: "Unknown", isSystem: false },
      }))}
      initialNextCursor={nextCursor}
    />
  );
}
