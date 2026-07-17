import type { ReactElement } from "react";
import Link from "next/link";
import { Card } from "@/components/card";
import MoneyText from "@/components/money-text"; // default export
import type { BookKpis } from "@/lib/home/types";

// The money pair leads: wider cell, 30px figure, a data-palette left rule.
// Rules are --data-* and never accent — accent means "action", and a KPI is
// not an action. Blue = the book we manage, orange = the opportunity.
// Left-rule colours are --data-* only — never accent (accent means "action"),
// never data-teal (reads as accent). A literal union makes the compiler enforce
// the brand rule instead of leaving it to the comment above.
const MONEY_TILES: {
  label: string;
  value: (k: BookKpis) => number;
  sub: (k: BookKpis) => string;
  rule: "bg-data-blue" | "bg-data-orange";
  href: string;
}[] = [
  {
    label: "Total book value",
    value: (k) => k.totalBookValue,
    sub: () => "as of today",
    rule: "bg-data-blue",
    href: "/home/book?focus=book",
  },
  {
    label: "Assets held away",
    value: (k) => k.assetsHeldAway,
    sub: (k) =>
      k.heldAwayAccounts === 1
        ? "across 1 account"
        : `across ${k.heldAwayAccounts} accounts`,
    rule: "bg-data-orange",
    href: "/home/book?focus=held-away",
  },
];

const COUNT_TILES: {
  label: string;
  value: (k: BookKpis) => number;
  sub: ((k: BookKpis) => string) | null;
}[] = [
  {
    label: "Households",
    value: (k) => k.activeHouseholds,
    sub: (k) => `+${k.prospectHouseholds} prospects`,
  },
  { label: "Planning clients", value: (k) => k.planningClients, sub: null },
  {
    label: "Tasks due this week",
    value: (k) => k.tasksDueThisWeek,
    sub: (k) => `${k.tasksDueThisWeekMine} assigned to me`,
  },
];

function TileLabel({ children }: { children: string }): ReactElement {
  return (
    <div className="text-xs uppercase tracking-wide text-ink-3 tabular">
      {children}
    </div>
  );
}

export function KpiRow({ kpis }: { kpis: BookKpis | null }): ReactElement {
  // Section-level degradation: with kpis null each tile keeps its label and
  // MoneyText renders the nullish value as an em-dash.
  return (
    <div className="grid grid-cols-6 gap-3 lg:grid-cols-12">
      {MONEY_TILES.map((t) => {
        const body = (
          <Card className="relative col-span-3 overflow-hidden px-[var(--pad-card)] py-5 transition-colors group-hover:bg-card-2">
            <span
              aria-hidden
              className={`absolute inset-y-0 left-0 w-[3px] ${t.rule}`}
            />
            <TileLabel>{t.label}</TileLabel>
            <div className="mt-1.5 text-ink">
              <MoneyText
                value={kpis ? t.value(kpis) : null}
                format="currency"
                size="kpi"
              />
            </div>
            {kpis && (
              <div className="mt-1 text-xs text-ink-3">{t.sub(kpis)}</div>
            )}
          </Card>
        );
        return kpis ? (
          <Link
            key={t.label}
            href={t.href}
            className="group col-span-3 block"
            aria-label={t.label}
          >
            {body}
          </Link>
        ) : (
          <div key={t.label} className="col-span-3">
            {body}
          </div>
        );
      })}
      {COUNT_TILES.map((t) => (
        <Card key={t.label} className="col-span-2 px-4 py-4">
          <TileLabel>{t.label}</TileLabel>
          <div className="mt-1 text-ink">
            <MoneyText
              value={kpis ? t.value(kpis) : null}
              format="int"
              size="kpiSm"
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
