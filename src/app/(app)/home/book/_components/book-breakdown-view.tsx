// src/app/(app)/home/book/_components/book-breakdown-view.tsx
"use client";

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Card } from "@/components/card";
import MoneyText from "@/components/money-text";
import type { BookBreakdown, BookFocus, BookHouseholdRow } from "@/lib/home/book-breakdown";

type SortKey = "householdName" | "bookValue" | "heldAway" | "total";
type SortDir = "asc" | "desc";

const CATEGORY_LABEL: Record<string, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
};

function TotalTile({
  label,
  value,
  rule,
  emphasized,
}: {
  label: string;
  value: number;
  rule: "bg-data-blue" | "bg-data-orange";
  emphasized: boolean;
}): ReactElement {
  return (
    <Card className={`relative overflow-hidden px-[var(--pad-card)] py-5 ${emphasized ? "" : "opacity-90"}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${rule}`} />
      <div className="text-xs uppercase tracking-wide text-ink-3 tabular">{label}</div>
      <div className="mt-1.5 text-ink">
        <MoneyText value={value} format="currency" size="kpi" />
      </div>
    </Card>
  );
}

function Insights({ data }: { data: BookBreakdown }): ReactElement {
  const { concentration, totals } = data;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card className="px-4 py-3">
        <div className="text-[22px] font-medium tracking-[-0.02em] text-ink tabular">
          {concentration.top5BookSharePct.toFixed(0)}%
        </div>
        <div className="mt-0.5 text-xs text-ink-3">Top 5 households’ share of book</div>
      </Card>
      <Card className="px-4 py-3">
        <div className="text-[22px] font-medium tracking-[-0.02em] text-ink tabular">
          <MoneyText value={concentration.largestHeldAway?.value ?? 0} format="currency" size="kpiSm" />
        </div>
        <div className="mt-0.5 text-xs text-ink-3">
          {concentration.largestHeldAway
            ? `Largest held-away — ${concentration.largestHeldAway.householdName}`
            : "No held-away assets"}
        </div>
      </Card>
      <Card className="px-4 py-3">
        <div className="text-[22px] font-medium tracking-[-0.02em] text-ink tabular">
          {totals.heldAwayAccounts}
        </div>
        <div className="mt-0.5 text-xs text-ink-3">
          Accounts held away across {concentration.heldAwayHouseholdCount} household
          {concentration.heldAwayHouseholdCount === 1 ? "" : "s"}
        </div>
      </Card>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  align,
}: {
  children: string;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  align: "left" | "right";
}): ReactElement {
  return (
    <th className={`px-3 py-2 font-normal ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        {active && <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function HouseholdRows({
  row,
  expanded,
  onToggle,
}: {
  row: BookHouseholdRow;
  expanded: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <>
      <tr data-testid="household-row" className="border-b border-hair hover:bg-card-2">
        <td className="px-3 py-2">
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 text-left hover:text-ink">
            <span aria-hidden className="text-ink-3">{expanded ? "▾" : "▸"}</span>
            <span data-testid="household-name">{row.householdName}</span>
          </button>
        </td>
        <td className="px-3 py-2 text-right"><MoneyText value={row.bookValue} format="currency" /></td>
        <td className="px-3 py-2 text-right"><MoneyText value={row.heldAway} format="currency" /></td>
        <td className="px-3 py-2 text-right"><MoneyText value={row.total} format="currency" /></td>
        <td className="px-3 py-2 text-right tabular">{row.accounts.length}</td>
      </tr>
      {expanded &&
        row.accounts.map((a) => (
          <tr key={a.accountId} className="border-b border-hair text-ink-3">
            <td className="px-3 py-1.5 pl-9">
              <span className="text-ink">{a.name}</span>
              <span className="ml-2 text-xs text-ink-3">{CATEGORY_LABEL[a.category] ?? a.category}</span>
            </td>
            <td className="px-3 py-1.5 text-right">
              {a.countsTowardAum ? <MoneyText value={a.value} format="currency" /> : <span className="text-ink-4">—</span>}
            </td>
            <td className="px-3 py-1.5 text-right">
              {a.countsTowardAum ? <span className="text-ink-4">—</span> : <MoneyText value={a.value} format="currency" />}
            </td>
            <td className="px-3 py-1.5 text-right">
              <span className={`text-[10px] uppercase tracking-wide ${a.countsTowardAum ? "text-data-blue" : "text-data-orange"}`}>
                {a.countsTowardAum ? "Managed" : "Held away"}
              </span>
            </td>
            <td className="px-3 py-1.5" />
          </tr>
        ))}
    </>
  );
}

export function BookBreakdownView({
  data,
  focus,
}: {
  data: BookBreakdown;
  focus: BookFocus;
}): ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>(focus === "held-away" ? "heldAway" : "bookValue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const sorted = useMemo(() => {
    const rows = [...data.households];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data.households, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "householdName" ? "asc" : "desc");
    }
  }
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (data.households.length === 0) {
    return (
      <Card className="px-[var(--pad-card)] py-10 text-center">
        <div className="text-sm text-ink">No book value or held-away assets yet</div>
        <div className="mt-1 text-xs text-ink-3">
          Flag AUM-eligible accounts as counting toward AUM to build the book.
        </div>
      </Card>
    );
  }

  const totalAccounts = data.households.reduce((s, h) => s + h.accounts.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TotalTile label="Total book value" value={data.totals.bookValue} rule="bg-data-blue" emphasized={focus === "book"} />
        <TotalTile label="Assets held away" value={data.totals.heldAway} rule="bg-data-orange" emphasized={focus === "held-away"} />
      </div>

      <Insights data={data} />

      {/* CHART SLOT — Task 4 inserts <BookSplitChart data={data} /> here. */}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hair text-xs uppercase tracking-wide text-ink-3">
              <Th onClick={() => toggleSort("householdName")} active={sortKey === "householdName"} dir={sortDir} align="left">Household</Th>
              <Th onClick={() => toggleSort("bookValue")} active={sortKey === "bookValue"} dir={sortDir} align="right">Book value</Th>
              <Th onClick={() => toggleSort("heldAway")} active={sortKey === "heldAway"} dir={sortDir} align="right">Held away</Th>
              <Th onClick={() => toggleSort("total")} active={sortKey === "total"} dir={sortDir} align="right">Total</Th>
              <th className="px-3 py-2 text-right font-normal">Accounts</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => (
              <HouseholdRows
                key={h.householdId}
                row={h}
                expanded={expanded.has(h.householdId)}
                onToggle={() => toggleExpand(h.householdId)}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-hair font-medium text-ink">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right"><MoneyText value={data.totals.bookValue} format="currency" /></td>
              <td className="px-3 py-2 text-right"><MoneyText value={data.totals.heldAway} format="currency" /></td>
              <td className="px-3 py-2 text-right"><MoneyText value={data.totals.total} format="currency" /></td>
              <td className="px-3 py-2 text-right tabular">{totalAccounts}</td>
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}
