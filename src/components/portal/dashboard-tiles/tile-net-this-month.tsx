import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { TileFrame } from "./tile-frame";

export function TileNetThisMonth({
  netThisMonth,
}: {
  netThisMonth: PortalDashboardDTO["netThisMonth"];
}): ReactElement {
  const positive = netThisMonth.net >= 0;
  const up = netThisMonth.deltaAbs >= 0;
  return (
    <TileFrame title="Net this month" href="/portal/budget" linkLabel="Budget">
      <div className={`mb-1 tabular text-[28px] font-semibold ${positive ? "text-ink" : "text-crit"}`}>
        {fmtUsd(netThisMonth.net)}
      </div>
      <div className="mb-4 text-[12px] text-ink-3">
        {netThisMonth.deltaPct == null ? (
          "No prior month to compare"
        ) : (
          <>
            <span className={up ? "text-good" : "text-crit"}>
              {up ? "▲" : "▼"} {Math.abs(netThisMonth.deltaPct)}%
            </span>{" "}
            vs <span className="tabular">{fmtUsd(netThisMonth.prior)}</span> last month
          </>
        )}
      </div>
      <div className="flex justify-between text-[12px]">
        <span className="text-ink-3">
          Income <span className="tabular text-good">{fmtUsd(netThisMonth.income)}</span>
        </span>
        <span className="text-ink-3">
          Spend <span className="tabular text-ink-2">{fmtUsd(netThisMonth.spent)}</span>
        </span>
      </div>
    </TileFrame>
  );
}
