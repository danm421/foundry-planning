import type { ReactElement } from "react";
import { requireOrgId } from "@/lib/db-helpers";
import {
  listClientActivity,
  type ActionKind,
  type DateRange,
} from "@/lib/activity/list-client-activity";
import { resolveActors } from "@/lib/activity/resolve-actors";
import ActivityPage from "@/components/activity/activity-page";

const VALID_KINDS: ActionKind[] = ["create", "update", "delete", "other"];
const VALID_RANGES: DateRange[] = ["7d", "30d", "90d", "all"];

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ActivityRoute({
  params,
  searchParams,
}: Props): Promise<ReactElement> {
  const [{ id: clientId }, firmId, sp] = await Promise.all([
    params,
    requireOrgId(),
    searchParams,
  ]);

  const get = (k: string): string | null => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
  };

  const kindRaw = get("kind");
  const rangeRaw = get("range");

  const filters = {
    actorId: get("actor"),
    resourceType: get("entity"),
    actionKind: VALID_KINDS.includes(kindRaw as ActionKind)
      ? (kindRaw as ActionKind)
      : null,
    range: (VALID_RANGES.includes(rangeRaw as DateRange)
      ? (rangeRaw as DateRange)
      : "90d") as DateRange,
  };

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
