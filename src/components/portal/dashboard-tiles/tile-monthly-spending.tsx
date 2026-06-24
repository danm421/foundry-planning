import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { TileFrame } from "./tile-frame";

/** Tiny SVG of cumulative spend (solid) vs linear pace (dashed). */
function PaceSparkline({
  pace,
  budgeted,
}: {
  pace: PortalDashboardDTO["spending"]["pace"];
  budgeted: number;
}): ReactElement | null {
  if (pace.length < 2 || budgeted <= 0) return null;
  const w = 280;
  const h = 80;
  const maxX = pace[pace.length - 1].day;
  const maxY = Math.max(budgeted, ...pace.map((p) => p.cumulative)) || 1;
  const x = (d: number) => (d / maxX) * w;
  const y = (v: number) => h - (v / maxY) * h;
  const cum = pace.map((p) => `${x(p.day)},${y(p.cumulative)}`).join(" ");
  const line = pace.map((p) => `${x(p.day)},${y(p.pace)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={line} fill="none" stroke="var(--color-ink-4)" strokeWidth={1.5} strokeDasharray="4 4" />
      <polyline points={cum} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
    </svg>
  );
}

export function TileMonthlySpending({
  spending,
}: {
  spending: PortalDashboardDTO["spending"];
}): ReactElement {
  const under = spending.underBy >= 0;
  return (
    <TileFrame title="Monthly spending" href="/portal/transactions" linkLabel="Transactions">
      {spending.budgeted > 0 ? (
        <>
          <div className="mb-1 tabular text-[28px] font-semibold text-ink">
            {fmtUsd(spending.left)} <span className="text-[15px] font-normal text-ink-3">left</span>
          </div>
          <div className="mb-3 text-[12px] text-ink-3">
            out of <span className="tabular">{fmtUsd(spending.budgeted)}</span> budgeted
          </div>
          <PaceSparkline pace={spending.pace} budgeted={spending.budgeted} />
          <div
            className={`mt-2 inline-block rounded-md px-2 py-0.5 text-[11px] tabular ${
              under ? "bg-good/15 text-good" : "bg-crit/15 text-crit"
            }`}
          >
            {fmtUsd(Math.abs(spending.underBy))} {under ? "under" : "over"} pace
          </div>
        </>
      ) : (
        <p className="text-[13px] text-ink-3">No budget set yet.</p>
      )}
    </TileFrame>
  );
}
