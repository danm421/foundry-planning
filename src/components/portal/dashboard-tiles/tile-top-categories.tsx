import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { TileFrame } from "./tile-frame";

export function TileTopCategories({
  topCategories,
  onOpen,
}: {
  topCategories: PortalDashboardDTO["topCategories"];
  onOpen: (categoryId: string, name: string) => void;
}): ReactElement {
  return (
    <TileFrame title="Top categories" href="/portal/budget" linkLabel="View all">
      {topCategories.length === 0 ? (
        <p className="text-[13px] text-ink-3">No spending yet this month.</p>
      ) : (
        <ul className="space-y-3">
          {topCategories.map((c) => {
            const over = c.budget != null && c.spent > c.budget;
            const pct = c.budget && c.budget > 0 ? Math.min(100, (c.spent / c.budget) * 100) : 0;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id, c.name)}
                  className="w-full rounded-md px-2 py-1 text-left hover:bg-card-2"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[13px] text-ink-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <span className="tabular text-[13px] text-ink">
                      {fmtUsd(c.spent)}
                      {c.budget != null && (
                        <span className="text-ink-3"> / {fmtUsd(c.budget)}</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
                    <div
                      className={`h-full ${over ? "bg-crit" : "bg-good"}`}
                      style={{ width: `${c.budget ? pct : 100}%` }}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </TileFrame>
  );
}
