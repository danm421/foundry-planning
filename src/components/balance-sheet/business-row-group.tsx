"use client";

import { ChevronDown, ChevronRight, TrashIcon, LinkedSourceBadge } from "./icons";
import type { AccountRow, LiabilityRow } from "@/components/balance-sheet-view";

interface BusinessRowGroupProps {
  biz: AccountRow;
  children_: AccountRow[];
  childLiabilities: LiabilityRow[];
  ownedIncomes: { id: string; name: string }[];
  expanded: boolean;
  onToggle: () => void;
  incomesPopoverOpen: boolean;
  onToggleIncomesPopover: () => void;
  consolidatedValue: number;
  onClickRow?: () => void;
  onDeleteRow?: () => void;
  onClickChild?: (child: AccountRow) => void;
  onDeleteChild?: (child: AccountRow) => void;
  onClickChildLiability?: (l: LiabilityRow) => void;
  editMode: boolean;
  ownerDisplay: (a: AccountRow) => string;
  growthDisplay: (a: AccountRow) => string;
  currentYearBalance: (l: LiabilityRow) => number;
}

function BusinessRowGroup({
  biz,
  children_,
  childLiabilities,
  ownedIncomes,
  expanded,
  onToggle,
  incomesPopoverOpen,
  onToggleIncomesPopover,
  consolidatedValue,
  onClickRow,
  onDeleteRow,
  onClickChild,
  onDeleteChild,
  onClickChildLiability,
  editMode,
  ownerDisplay,
  growthDisplay,
  currentYearBalance,
}: BusinessRowGroupProps) {
  const hasChildren = children_.length > 0 || childLiabilities.length > 0 || ownedIncomes.length > 0;
  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/60">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center text-gray-400 hover:text-gray-100 disabled:opacity-40"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          disabled={!hasChildren}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </button>
        <div
          onClick={onClickRow}
          className={`flex flex-1 items-center justify-between ${onClickRow ? "cursor-pointer" : ""}`}
        >
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium text-gray-100">{biz.name}</span>
              {biz.linkedSource && <LinkedSourceBadge source={biz.linkedSource} />}
            </div>
            <div className="truncate text-xs text-gray-400">
              {ownerDisplay(biz)} · {growthDisplay(biz)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-100">
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(consolidatedValue)}
            </span>
            {editMode && onDeleteRow && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRow();
                }}
                className="text-white hover:text-white"
                aria-label={`Delete ${biz.name}`}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="bg-gray-950/40 px-4 py-2 pl-12">
          {children_.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Owned accounts
              </div>
              <div className="divide-y divide-gray-800/60 overflow-hidden rounded-md border border-gray-800/80">
                {children_.map((c) => (
                  <div
                    key={c.id}
                    onClick={onClickChild ? () => onClickChild(c) : undefined}
                    className={`flex items-center justify-between px-3 py-1.5 ${onClickChild ? "cursor-pointer hover:bg-gray-800/60" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] text-gray-100">{c.name}</span>
                        {c.linkedSource && <LinkedSourceBadge source={c.linkedSource} />}
                      </div>
                      <div className="truncate text-[11px] text-gray-500">{c.category}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] text-gray-100">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 0,
                        }).format(Number(c.value))}
                      </span>
                      {editMode && onDeleteChild && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteChild(c);
                          }}
                          className="text-white hover:text-white"
                          aria-label={`Delete ${c.name}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {childLiabilities.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Owed liabilities
              </div>
              <div className="divide-y divide-gray-800/60 overflow-hidden rounded-md border border-gray-800/80">
                {childLiabilities.map((l) => (
                  <div
                    key={l.id}
                    onClick={onClickChildLiability ? () => onClickChildLiability(l) : undefined}
                    className={`flex items-center justify-between px-3 py-1.5 ${onClickChildLiability ? "cursor-pointer hover:bg-gray-800/60" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-gray-100">{l.name}</div>
                    </div>
                    <span className="text-[13px] text-red-400">
                      (
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      }).format(currentYearBalance(l))}
                      )
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ownedIncomes.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={onToggleIncomesPopover}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-900/50"
                aria-expanded={incomesPopoverOpen}
                aria-haspopup="dialog"
              >
                Incomes · {ownedIncomes.length}
              </button>
              {incomesPopoverOpen && (
                <div
                  role="dialog"
                  className="absolute left-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-gray-700 bg-gray-900 shadow-lg"
                >
                  <ul className="max-h-56 overflow-y-auto py-1">
                    {ownedIncomes.map((i) => (
                      <li
                        key={i.id}
                        className="px-3 py-1.5 text-[12px] text-gray-200"
                      >
                        {i.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default BusinessRowGroup;
