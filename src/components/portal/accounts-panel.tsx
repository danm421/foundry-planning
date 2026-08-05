"use client";

import type { ReactElement } from "react";
import type { PortalAccountRow, PortalDebtRow } from "@/lib/portal/contracts";
import type { TrendPoint } from "@/lib/portal/networth-trend";
import {
  assetCardSubtitle,
  debtCardSubtitle,
  type AccountRail,
  type RailRow,
} from "@/lib/portal/account-rail";
import { fmtUsd } from "@/lib/portal/format";
import { NetWorthTrendChart } from "@/components/portal/networth-trend-chart";
import { AccountCard, type AccountCardData } from "@/components/portal/account-card";
import { TOTAL_KEY, type RailSelection } from "@/components/portal/account-rail-nav";

function assetCard(a: PortalAccountRow): AccountCardData {
  return {
    id: a.id,
    name: a.name,
    last4: a.last4,
    subtitle: assetCardSubtitle(a),
    value: a.value,
    isPlaidLinked: a.isPlaidLinked,
  };
}

function debtCard(d: PortalDebtRow): AccountCardData {
  return {
    id: d.id,
    name: d.name,
    last4: null,
    subtitle: debtCardSubtitle(d),
    value: d.balance,
    isPlaidLinked: d.isPlaidLinked,
  };
}

function CardList({
  cards,
  onOpen,
}: {
  cards: AccountCardData[];
  onOpen: (id: string) => void;
}): ReactElement {
  return (
    <ul className="space-y-2">
      {cards.map((c) => (
        <li key={c.id}>
          <AccountCard card={c} onOpen={() => onOpen(c.id)} />
        </li>
      ))}
    </ul>
  );
}

export function AccountsPanel({
  rail,
  assets,
  debts,
  series,
  asOfDate,
  selected,
  onOpenAccount,
  onOpenDebt,
}: {
  rail: AccountRail;
  assets: PortalAccountRow[];
  debts: PortalDebtRow[];
  series: TrendPoint[];
  asOfDate: string;
  selected: RailSelection;
  onOpenAccount: (id: string) => void;
  onOpenDebt: (id: string) => void;
}): ReactElement {
  if (assets.length === 0 && debts.length === 0) {
    return <p className="text-[13px] text-ink-3">No accounts yet.</p>;
  }

  // Both views draw the same cards from the same row; only the surrounding
  // heading differs, so the row → cards and row → handler mappings live here.
  const cardsForRow = (row: RailRow): AccountCardData[] =>
    row.kind === "asset"
      ? assets.filter((a) => a.category === row.category).map(assetCard)
      : debts.filter((d) => (d.liabilityType ?? "other") === row.category).map(debtCard);
  const openFor = (row: RailRow) => (row.kind === "asset" ? onOpenAccount : onOpenDebt);

  // Category view: one group's cards, no chart.
  if (selected !== TOTAL_KEY) {
    const row: RailRow | undefined =
      rail.assets.rows.find((r) => r.key === selected) ??
      rail.liabilities.rows.find((r) => r.key === selected);
    if (!row) return <p className="text-[13px] text-ink-3">Nothing in this category.</p>;

    return (
      <section className="space-y-3">
        {/* The transparent y-border + py-2 reproduce the rail hero's box
            (border + py-2, same 15px line box), so this heading's baseline
            lands on "Total Net Worth" across the gutter. */}
        <h2 className="border-y border-transparent py-2 text-[15px] font-semibold text-ink">
          {row.label}: <span className="tabular">{fmtUsd(row.total)}</span>
        </h2>
        <CardList cards={cardsForRow(row)} onOpen={openFor(row)} />
      </section>
    );
  }

  // Default view: trend chart, then every account under its category subhead.
  return (
    <div className="space-y-6">
      {series.length >= 2 && <NetWorthTrendChart series={series} asOfDate={asOfDate} />}
      {[...rail.assets.rows, ...rail.liabilities.rows].map((row) => (
        <section key={row.key} className="space-y-2">
          <h2 className="flex items-baseline justify-between border-b border-hair pb-1">
            <span className="text-[13px] font-semibold text-ink">{row.label}</span>
            <span className="tabular text-[12px] text-ink-3">{fmtUsd(row.total)}</span>
          </h2>
          <CardList cards={cardsForRow(row)} onOpen={openFor(row)} />
        </section>
      ))}
    </div>
  );
}
