import type { ReactElement } from "react";
import { Card } from "@/components/card";
import MoneyText from "@/components/money-text"; // default export
import type { BookKpis } from "@/lib/home/types";

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactElement | string;
  sub: string | null;
}): ReactElement {
  return (
    <Card className="px-[var(--pad-card)] py-4">
      <div className="text-xs uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink tabular">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </Card>
  );
}

export function KpiRow({ kpis }: { kpis: BookKpis | null }): ReactElement {
  if (!kpis) {
    // Section-level degradation: keep layout, show em-dashes.
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {["Total book value", "Households", "Planning clients", "Tasks due this week"].map(
          (label) => (
            <Tile key={label} label={label} value="—" sub={null} />
          ),
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Total book value"
        value={<MoneyText value={kpis.totalBookValue} format="currency" size="kpi" />}
        sub="as of today"
      />
      <Tile
        label="Households"
        value={String(kpis.activeHouseholds)}
        sub={`+${kpis.prospectHouseholds} prospects`}
      />
      <Tile
        label="Planning clients"
        value={String(kpis.planningClients)}
        sub={null}
      />
      <Tile
        label="Tasks due this week"
        value={String(kpis.tasksDueThisWeek)}
        sub={`${kpis.tasksDueThisWeekMine} assigned to me`}
      />
    </div>
  );
}
