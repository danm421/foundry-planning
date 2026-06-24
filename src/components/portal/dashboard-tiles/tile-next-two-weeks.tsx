import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { TileFrame } from "./tile-frame";

function dueLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function TileNextTwoWeeks({
  recurrings,
  onOpen,
}: {
  recurrings: PortalDashboardDTO["recurrings"];
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <TileFrame title="Next two weeks" href="/portal/recurrings" linkLabel="Recurrings">
      {recurrings.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing due in the next two weeks.</p>
      ) : (
        <ul className="space-y-1">
          {recurrings.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-card-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink-2">{r.name}</span>
                  <span
                    className={`text-[11px] ${r.state === "overdue" ? "text-crit" : "text-ink-3"}`}
                  >
                    {r.state === "overdue" ? "Overdue" : dueLabel(r.dueDate)}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[13px] text-ink">{fmtUsd(r.predicted)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </TileFrame>
  );
}
