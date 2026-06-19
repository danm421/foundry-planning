import type { ReactElement } from "react";
import { getPortalActivity } from "@/lib/audit/queries";

interface Props {
  clientId: string;
}

export default async function PortalActivityFeed({
  clientId,
}: Props): Promise<ReactElement> {
  const rows = await getPortalActivity({ clientId, limit: 30 });

  return (
    <section className="rounded-md border border-hair bg-paper p-5">
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-medium text-ink">Recent activity</h3>
        <span className="text-[12px] text-ink-3">Client edits only</span>
      </header>

      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          No client-side activity yet.
        </p>
      ) : (
        <ol className="divide-y divide-hair">
          {rows.map((r) => (
            <li key={r.id} className="py-2 flex items-baseline gap-3 text-[13px]">
              <time className="text-ink-3 tabular-nums text-[12px] shrink-0 w-[140px]">
                {new Date(r.createdAt).toLocaleString()}
              </time>
              <span className="text-ink-2 shrink-0 w-[140px] truncate">
                {r.resourceType}
              </span>
              <span className="text-ink">{r.action.replace(/^portal\./, "")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
