"use client";

// Search-and-pick list of plan details, in a popover under the Edit or Delete
// button. Grouped like the Add menu; a type whose editor isn't ready yet is
// listed greyed so the advisor sees it exists, but can't be picked.

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import {
  DETAIL_GROUP_ORDER,
  NOT_YET_READY,
  NOT_YET_READY_TITLE,
  detailType,
  type DetailGroup,
} from "@/lib/scenario/plan-detail-catalog";
import { SolverAnchoredPopover } from "./solver-anchored-popover";

export interface SolverDetailPickerProps {
  anchor: HTMLElement;
  title: string;
  items: InventoryItem[];
  onPick: (item: InventoryItem) => void;
  onClose: () => void;
}

export function SolverDetailPicker({ anchor, title, items, onPick, onClose }: SolverDetailPickerProps) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const matches = items.filter((i) =>
      q === "" ||
      [i.label, i.sublabel, detailType(i.typeKey).label].some((s) => s?.toLowerCase().includes(q)),
    );
    return DETAIL_GROUP_ORDER.map((group) => ({
      group,
      items: matches.filter((i) => detailType(i.typeKey).group === group),
    })).filter((g) => g.items.length > 0);
  }, [items, q]);

  // Arrow keys walk the search box and the enabled options as one list.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const stops = [
      searchRef.current,
      ...Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])') ?? []),
    ].filter((el): el is HTMLElement => el !== null);
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = stops[Math.min(stops.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  return (
    <SolverAnchoredPopover anchor={anchor} label={title} onClose={onClose} className="w-72">
      {/* The key handler is delegation for the search box and options inside. */}
      <div onKeyDown={onKeyDown}>
        <div className="border-b border-hair p-2">
          <input
            ref={searchRef}
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label={`Search — ${title}`}
            className="h-8 w-full rounded-md border border-hair-2 bg-card-2 px-2 text-[13px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
          />
        </div>
        <div ref={listRef} role="listbox" aria-label={title} className="max-h-80 overflow-y-auto py-1">
          {groups.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-ink-3">Nothing matches &quot;{query.trim()}&quot;.</div>
          )}
          {groups.map(({ group, items: rows }) => (
            <PickerGroup key={group} group={group}>
              {rows.map((item) => {
                const notReady = NOT_YET_READY.has(item.typeKey);
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={notReady}
                    title={notReady ? NOT_YET_READY_TITLE : undefined}
                    onClick={() => onPick(item)}
                    className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span className="truncate text-[13px] text-ink">{item.label}</span>
                    {item.sublabel && <span className="truncate text-[11px] text-ink-3">{item.sublabel}</span>}
                  </button>
                );
              })}
            </PickerGroup>
          ))}
        </div>
      </div>
    </SolverAnchoredPopover>
  );
}

function PickerGroup({ group, children }: { group: DetailGroup; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={group}>
      <div aria-hidden="true" className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {group}
      </div>
      {children}
    </div>
  );
}
