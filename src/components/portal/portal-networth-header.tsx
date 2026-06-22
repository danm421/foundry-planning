import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`text-xl font-semibold ${accent ? "text-accent" : "text-ink"}`}>
        {fmtUsd(value)}
      </div>
    </div>
  );
}

export function PortalNetWorthHeader({
  assets, debt, netWorth,
}: { assets: number; debt: number; netWorth: number }): ReactElement {
  return (
    <header className="grid grid-cols-3 gap-4 rounded-xl border border-hair bg-card p-5">
      <Stat label="Assets" value={assets} />
      <Stat label="Debt" value={debt} />
      <Stat label="Net worth" value={netWorth} accent />
    </header>
  );
}
