import type { ReactElement } from "react";
import { Card } from "@/components/card";
import MoneyText from "@/components/money-text"; // default export
import type { BookKpis } from "@/lib/home/types";

const TILES: {
  label: string;
  format: "currency" | "int";
  value: (k: BookKpis) => number;
  sub: ((k: BookKpis) => string) | null;
}[] = [
  {
    label: "Total book value",
    format: "currency",
    value: (k) => k.totalBookValue,
    sub: () => "as of today",
  },
  {
    label: "Households",
    format: "int",
    value: (k) => k.activeHouseholds,
    sub: (k) => `+${k.prospectHouseholds} prospects`,
  },
  {
    label: "Planning clients",
    format: "int",
    value: (k) => k.planningClients,
    sub: null,
  },
  {
    label: "Tasks due this week",
    format: "int",
    value: (k) => k.tasksDueThisWeek,
    sub: (k) => `${k.tasksDueThisWeekMine} assigned to me`,
  },
];

export function KpiRow({ kpis }: { kpis: BookKpis | null }): ReactElement {
  // Section-level degradation: with kpis null each tile keeps its label and
  // MoneyText renders the nullish value as an em-dash.
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILES.map((t) => (
        <Card key={t.label} className="px-[var(--pad-card)] py-4">
          <div className="text-xs uppercase tracking-wide text-ink-3 tabular">
            {t.label}
          </div>
          <div className="mt-1 text-ink">
            <MoneyText
              value={kpis ? t.value(kpis) : null}
              format={t.format}
              size="kpi"
            />
          </div>
          {kpis && t.sub && (
            <div className="mt-0.5 text-xs text-ink-3">{t.sub(kpis)}</div>
          )}
        </Card>
      ))}
    </div>
  );
}
