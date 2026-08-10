"use client";
import { useState, type ReactElement, type ReactNode } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import { NetWorthTrendChart } from "@/components/portal/networth-trend-chart";
import { TileFrame } from "./tile-frame";

/** How many accounts the list shows before "Show all". */
const TOP_ACCOUNTS = 5;

/** A hairline-separated block under the chart. Both lists below use it, so the
 *  breakdown and the account list can't drift apart on spacing. */
function Section({ heading, children }: { heading: string; children: ReactNode }): ReactElement {
  return (
    <div className="mt-4 border-t border-hair pt-3">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-3">{heading}</div>
      <ul className="space-y-1.5">{children}</ul>
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

      {netWorth.assetGroups.length > 0 && (
        <Section heading="By type">
          {netWorth.assetGroups.map((g) => {
            const share = netWorth.assets > 0 ? (g.total / netWorth.assets) * 100 : 0;
            return (
              <li key={g.category}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-ink-2">{g.label}</span>
                  <span className="tabular text-ink">{fmtUsd(g.total)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-card-2">
                  <div className="h-full bg-ink-4" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </Section>
      )}

      {netWorth.accounts.length > 0 && (
        <>
          <Section heading={hasMore && !expanded ? `Top ${TOP_ACCOUNTS} accounts` : "Accounts"}>
            {accounts.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate text-ink-2">{a.name}</span>
                <span className="tabular shrink-0 text-ink">{fmtUsd(a.value)}</span>
              </li>
            ))}
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
