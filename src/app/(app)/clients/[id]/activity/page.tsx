import type { ReactElement } from "react";
import { Suspense } from "react";
import { requireOrgId } from "@/lib/db-helpers";
import type { ActionKind, DateRange } from "@/lib/activity/list-client-activity";
import { ActivityContent } from "./activity-content";
import ActivitySkeleton from "./loading-skeleton";

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

  return (
    <Suspense fallback={<ActivitySkeleton />}>
      <ActivityContent
        clientId={clientId}
        firmId={firmId}
        actorId={get("actor")}
        resourceType={get("entity")}
        actionKind={
          VALID_KINDS.includes(kindRaw as ActionKind)
            ? (kindRaw as ActionKind)
            : null
        }
        range={
          (VALID_RANGES.includes(rangeRaw as DateRange)
            ? (rangeRaw as DateRange)
            : "90d") as DateRange
        }
      />
    </Suspense>
  );
}
