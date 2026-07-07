import type { ReactElement } from "react";
import {
  listClientActivity,
  listActivityResourceTypes,
  listActivityActors,
  type ActionKind,
  type DateRange,
} from "@/lib/activity/list-client-activity";
import {
  hydrateRowActors,
  resolveActorNames,
} from "@/lib/activity/resolve-actors";
import { pickActor } from "@/lib/activity/actor-display";
import { resourceTypeLabel } from "@/lib/activity/resource-labels";
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

  // Filter options are derived from what actually exists for this client, so
  // the dropdowns never offer an entity or person with zero activity. These
  // are unaffected by the active filters (they scan the whole client history).
  const [{ rows, nextCursor }, resourceTypes, actorRows] = await Promise.all([
    listClientActivity({ clientId, firmId, filters, cursor: null, limit: 50 }),
    listActivityResourceTypes({ clientId, firmId }),
    listActivityActors({ clientId, firmId }),
  ]);

  const initialRows = await hydrateRowActors(rows);

  const entityOptions = resourceTypes.map((value) => ({
    value,
    label: resourceTypeLabel(value),
  }));

  const liveNames = await resolveActorNames(actorRows.map((a) => a.actorId));
  const actorOptions = actorRows.map((a) => ({
    value: a.actorId,
    label: pickActor(a.actorId, { actorName: a.snapshotName }, liveNames).name,
  }));

  return (
    <ActivityPage
      clientId={clientId}
      filters={filters}
      entityOptions={entityOptions}
      actorOptions={actorOptions}
      initialRows={initialRows}
      initialNextCursor={nextCursor}
    />
  );
}
