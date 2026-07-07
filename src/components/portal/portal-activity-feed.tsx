import type { ReactElement } from "react";
import { getPortalActivity } from "@/lib/audit/queries";
import {
  AREA_BY_RESOURCE_TYPE,
  areaShared,
  loadPortalPrivacy,
} from "@/lib/portal/privacy";
import PortalCard from "@/components/portal/portal-card";
import { HistoryIcon } from "@/components/portal/portal-icons";

interface Props {
  clientId: string;
}

const HIDDEN_AREA_LABELS = {
  transactions: "transactions",
  budgets: "budget",
  recurrings: "recurring bills",
} as const;

export default async function PortalActivityFeed({
  clientId,
}: Props): Promise<ReactElement> {
  const [allRows, privacy] = await Promise.all([
    getPortalActivity({ clientId, limit: 30 }),
    loadPortalPrivacy(clientId),
  ]);
  // Drop diffs from budgeting areas the client keeps private — the feed's
  // formatted metadata (amounts, category names) would otherwise leak them.
  const rows = allRows.filter((r) => {
    const area = AREA_BY_RESOURCE_TYPE[r.resourceType];
    return !area || areaShared(privacy, area);
  });
  const hidden = (Object.keys(HIDDEN_AREA_LABELS) as Array<keyof typeof HIDDEN_AREA_LABELS>)
    .filter((area) => !areaShared(privacy, area))
    .map((area) => HIDDEN_AREA_LABELS[area]);

  return (
    <PortalCard
      icon={<HistoryIcon />}
      title="Recent activity"
      action={
        <span className="text-[12px] text-ink-3">
          {hidden.length > 0 ? `Not shared: ${hidden.join(", ")}` : "Client edits only"}
        </span>
      }
    >
      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-3">No client-side activity yet.</p>
      ) : (
        <ol className="-my-2 divide-y divide-hair">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline gap-3 py-2 text-[13px]">
              <time className="tabular w-[120px] shrink-0 text-[12px] text-ink-3">
                {new Date(r.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
                {", "}
                {new Date(r.createdAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
              <span className="w-[120px] shrink-0 truncate text-ink-2">{r.resourceType}</span>
              <span className="min-w-0 truncate text-ink">{r.action.replace(/^portal\./, "")}</span>
            </li>
          ))}
        </ol>
      )}
    </PortalCard>
  );
}
