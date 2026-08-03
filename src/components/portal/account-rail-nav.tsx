"use client";

import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { AccountRail, RailGroup, RailRow } from "@/lib/portal/account-rail";

/** Selection key for the Total Net Worth hero — the "no category filter" state. */
export const TOTAL_KEY = "total";

/** Either TOTAL_KEY or a RailRow.key ("asset:cash", "liability:mortgage"). */
export type RailSelection = string;

function rowCls(active: boolean): string {
  return [
    "flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-[13px]",
    active ? "bg-card-2 text-ink" : "text-ink-2 hover:bg-card hover:text-ink",
  ].join(" ");
}

/** Liabilities read as a deduction: ($125,000). Assets read plain. */
function railTotal(row: RailRow): string {
  return row.kind === "liability" ? `(${fmtUsd(row.total)})` : fmtUsd(row.total);
}

function RailGroupSection({
  title,
  group,
  selected,
  onSelect,
}: {
  title: string;
  group: RailGroup;
  selected: RailSelection;
  onSelect: (key: RailSelection) => void;
}): ReactElement | null {
  if (group.rows.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between px-3 pb-1">
        <span className="text-[11px] uppercase tracking-wide text-ink-3">{title}</span>
        <span className="tabular text-[12px] text-ink-3">{fmtUsd(group.total)}</span>
      </div>
      <ul className="space-y-0.5">
        {group.rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => onSelect(row.key)}
              aria-current={selected === row.key ? "true" : undefined}
              className={rowCls(selected === row.key)}
            >
              <span className="truncate">{row.label}</span>
              <span className="tabular shrink-0">{railTotal(row)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AccountRailNav({
  rail,
  selected,
  onSelect,
}: {
  rail: AccountRail;
  selected: RailSelection;
  onSelect: (key: RailSelection) => void;
}): ReactElement {
  return (
    <nav aria-label="Account categories" className="space-y-4">
      <button
        type="button"
        onClick={() => onSelect(TOTAL_KEY)}
        aria-current={selected === TOTAL_KEY ? "true" : undefined}
        className={`${rowCls(selected === TOTAL_KEY)} border border-hair bg-card`}
      >
        <span className="text-[13px] font-semibold text-ink">Total Net Worth</span>
        <span className="tabular shrink-0 text-[15px] font-semibold text-ink">
          {fmtUsd(rail.netWorth)}
        </span>
      </button>
      <RailGroupSection title="Assets" group={rail.assets} selected={selected} onSelect={onSelect} />
      <RailGroupSection title="Liabilities" group={rail.liabilities} selected={selected} onSelect={onSelect} />
    </nav>
  );
}
