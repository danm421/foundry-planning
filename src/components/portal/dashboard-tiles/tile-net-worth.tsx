"use client";
import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { NetWorthTrendChart } from "@/components/portal/networth-trend-chart";
import { TileFrame } from "./tile-frame";

export function TileNetWorth({
  netWorth,
}: {
  netWorth: PortalDashboardDTO["netWorth"];
}): ReactElement {
  return (
    <TileFrame title="Net worth" href="/portal/accounts" linkLabel="Accounts">
      <div className="mb-4 flex gap-8">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Assets</div>
          <div className="tabular text-xl font-semibold text-ink">{fmtUsd(netWorth.assets)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Debt</div>
          <div className="tabular text-xl font-semibold text-ink">{fmtUsd(netWorth.debt)}</div>
        </div>
      </div>
      {netWorth.series.length >= 2 ? (
        <NetWorthTrendChart series={netWorth.series} asOfDate={netWorth.asOfDate} />
      ) : (
        <p className="text-[13px] text-ink-3">Not enough history yet.</p>
      )}
    </TileFrame>
  );
}
