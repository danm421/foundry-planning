"use client";
import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { NetWorthTrendChart } from "@/components/portal/networth-trend-chart";
import { TileFrame } from "./tile-frame";

export function TileNetWorth({
  netWorth,
  onOpen,
}: {
  netWorth: PortalDashboardDTO["netWorth"];
  onOpen: () => void;
}): ReactElement {
  return (
    <TileFrame title="Net worth" href="/accounts" linkLabel="Accounts">
      <button
        type="button"
        onClick={onOpen}
        className="-m-1 mb-3 flex w-full gap-8 rounded-md p-1 text-left hover:bg-card-2"
      >
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Assets</div>
          <div className="tabular text-xl font-semibold text-ink">{fmtUsd(netWorth.assets)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Debt</div>
          <div className="tabular text-xl font-semibold text-ink">{fmtUsd(netWorth.debt)}</div>
        </div>
      </button>
      {netWorth.series.length >= 2 ? (
        <NetWorthTrendChart series={netWorth.series} asOfDate={netWorth.asOfDate} />
      ) : (
        <p className="text-[13px] text-ink-3">Not enough history yet.</p>
      )}
    </TileFrame>
  );
}
