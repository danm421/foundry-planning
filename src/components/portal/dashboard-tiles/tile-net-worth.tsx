"use client";
import { useState, type ReactElement, type ReactNode } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { NetWorthTrendChart } from "@/components/portal/networth-trend-chart";
import { AssetTypePie } from "@/components/portal/asset-type-pie";
import { TileFrame } from "./tile-frame";

/** How many accounts the list shows before "Show all". */
const TOP_ACCOUNTS = 5;

/** A hairline-separated block under the chart. Both blocks below use it, so the
 *  breakdown and the account list can't drift apart on their rule and heading.
 *  The body is whatever the caller passes — the breakdown is a pie, not a list. */
function Section({ heading, children }: { heading: string; children: ReactNode }): ReactElement {
  return (
    <div className="mt-4 border-t border-hair pt-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-3">{heading}</div>
      {children}
    </div>
  );
}

export function TileNetWorth({
  netWorth,
  onOpen,
}: {
  netWorth: PortalDashboardDTO["netWorth"];
  onOpen: () => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const hasMore = netWorth.accounts.length > TOP_ACCOUNTS;
  const accounts = expanded ? netWorth.accounts : netWorth.accounts.slice(0, TOP_ACCOUNTS);

  return (
    <TileFrame title="Net worth" href="/organizer/accounts" linkLabel="Accounts">
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

      {netWorth.assetGroups.length > 0 && (
        <Section heading="By type">
          <AssetTypePie groups={netWorth.assetGroups} />
        </Section>
      )}

      {netWorth.accounts.length > 0 && (
        <>
          <Section heading={hasMore && !expanded ? `Top ${TOP_ACCOUNTS} accounts` : "Accounts"}>
            <ul className="space-y-1.5">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate text-ink-2">{a.name}</span>
                  <span className="tabular shrink-0 text-ink">{fmtUsd(a.value)}</span>
                </li>
              ))}
            </ul>
          </Section>
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 rounded-md text-[12px] text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              {expanded ? "Show less" : `Show ${netWorth.accounts.length - TOP_ACCOUNTS} more`}
            </button>
          )}
        </>
      )}
    </TileFrame>
  );
}
