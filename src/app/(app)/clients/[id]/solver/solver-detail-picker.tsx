"use client";

// Search-and-pick list of plan details, in a popover under the Edit or Remove
// button. Sections match the Add menu; inside one, each type is a category that
// expands to its items (all the incomes under Income). Searching opens every
// category with a match. A type whose editor isn't ready yet is listed greyed
// so the advisor sees it exists, but can't be picked.

import { Fragment, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { InventoryItem } from "@/lib/scenario/plan-inventory";
import {
  DETAIL_GROUP_ORDER,
  DETAIL_TYPES,
  NOT_YET_READY,
  NOT_YET_READY_TITLE,
  SINGLETON_FOCUS_ID,
  detailType,
  type DetailGroup,
  type DetailTypeKey,
} from "@/lib/scenario/plan-detail-catalog";
import { SolverAnchoredPopover } from "./solver-anchored-popover";

export interface SolverDetailPickerProps {
  anchor: HTMLElement;
  title: string;
  /** The CSS colour of the button that opened it; frames and tints the menu. */
  tone: string;
  items: InventoryItem[];
  onPick: (item: InventoryItem) => void;
  onClose: () => void;
}

// Client info and the Assumptions tabs only ever have one row, so it is listed
// directly rather than inside a category of one.
const oneOfAKind = (key: DetailTypeKey) => key === "client_info" || key in SINGLETON_FOCUS_ID;

export function SolverDetailPicker({ anchor, title, tone, items, onPick, onClose }: SolverDetailPickerProps) {
  const [query, setQuery] = useState("");
  // Categories the advisor flipped from the default — closed while browsing,
  // open while searching. Each new query starts from the default again.
  const [flipped, setFlipped] = useState<ReadonlySet<DetailTypeKey>>(new Set());
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
      categories: DETAIL_TYPES.filter((t) => t.group === group)
        .map((type) => ({ type, rows: matches.filter((i) => i.typeKey === type.key) }))
        .filter((c) => c.rows.length > 0),
    })).filter((g) => g.categories.length > 0);
  }, [items, q]);

  const isOpen = (key: DetailTypeKey) => (q !== "") !== flipped.has(key);
  function toggle(key: DetailTypeKey) {
    setFlipped((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  // Arrow keys walk the search box, the categories and the enabled items as one list.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const stops = [
      searchRef.current,
      ...Array.from(listRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []),
    ].filter((el): el is HTMLElement => el !== null);
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = stops[Math.min(stops.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  return (
    <SolverAnchoredPopover anchor={anchor} label={title} tone={tone} onClose={onClose} className="w-72">
      <MenuHeader title={title} />
      {/* The key handler is delegation for the search box and rows inside. */}
      <div onKeyDown={onKeyDown}>
        <div className="border-b border-hair-2 p-2">
          <input
            ref={searchRef}
            type="search"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFlipped(new Set());
            }}
            placeholder="Search"
            aria-label={`Search — ${title}`}
            className="h-8 w-full rounded-md border border-hair-3 bg-card-2 px-2 text-[13px] text-ink placeholder:text-ink-4 focus:border-[var(--tone)] focus:outline-none focus:ring-1 focus:ring-[var(--tone)]"
          />
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto pb-1">
          {groups.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-ink-3">Nothing matches &quot;{query.trim()}&quot;.</div>
          )}
          {groups.map(({ group, categories }) => (
            <MenuGroup key={group} group={group}>
              {categories.map(({ type, rows }) =>
                oneOfAKind(type.key) ? (
                  <Fragment key={type.key}>
                    {rows.map((item) => <PickRow key={item.key} item={item} onPick={onPick} />)}
                  </Fragment>
                ) : (
                  <Category
                    key={type.key}
                    label={type.label}
                    rows={rows}
                    open={isOpen(type.key)}
                    onToggle={() => toggle(type.key)}
                    onPick={onPick}
                  />
                ),
              )}
            </MenuGroup>
          ))}
        </div>
      </div>
    </SolverAnchoredPopover>
  );
}

function Category({
  label,
  rows,
  open,
  onToggle,
  onPick,
}: {
  label: string;
  rows: InventoryItem[];
  open: boolean;
  onToggle: () => void;
  onPick: (item: InventoryItem) => void;
}) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label} (${rows.length})`}
        onClick={onToggle}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] font-medium text-ink ${MENU_ROW_CLASS}`}
      >
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular text-[11px] font-normal text-ink-3">{rows.length}</span>
        <span aria-hidden="true" className="w-3 text-center text-ink-3">
          {open ? "−" : "+"}
        </span>
      </button>
      <div id={id}>
        {open && rows.map((item) => <PickRow key={item.key} item={item} indent onPick={onPick} />)}
      </div>
    </>
  );
}

function PickRow({ item, indent = false, onPick }: { item: InventoryItem; indent?: boolean; onPick: (item: InventoryItem) => void }) {
  const notReady = NOT_YET_READY.has(item.typeKey);
  return (
    <button
      type="button"
      disabled={notReady}
      title={notReady ? NOT_YET_READY_TITLE : undefined}
      onClick={() => onPick(item)}
      className={`flex w-full flex-col py-1.5 pr-3 text-left ${indent ? "pl-6" : "pl-3"} ${MENU_ROW_CLASS}`}
    >
      <span className="truncate text-[13px] text-ink">{item.label}</span>
      {item.sublabel && <span className="truncate text-[11px] text-ink-3">{item.sublabel}</span>}
    </button>
  );
}

// The pieces below are shared with the Add menu. They tint with `--tone`, the
// colour the popover shell is framed in.

/** Visible title strip. The dialog already carries the same name, so it is
 *  hidden from assistive tech rather than announced twice. */
export function MenuHeader({ title }: { title: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-2 rounded-t-[5px] border-b border-hair-2 bg-[var(--tone)]/15 px-3 py-2 text-[12px] font-semibold text-ink"
    >
      <span className="size-2 rounded-full bg-[var(--tone)]" />
      {title}
    </div>
  );
}

/** Highlight for a menu row: a tint plus a bar down the left edge, on hover and
 *  on keyboard focus alike. */
export const MENU_ROW_CLASS =
  "enabled:hover:bg-[var(--tone)]/15 enabled:hover:shadow-[inset_3px_0_0_var(--tone)] " +
  "focus-visible:bg-[var(--tone)]/15 focus-visible:shadow-[inset_3px_0_0_var(--tone)] focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function MenuGroup({ group, children }: { group: DetailGroup; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={group} className="border-t border-hair first:border-t-0">
      <div aria-hidden="true" className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {group}
      </div>
      {children}
    </div>
  );
}
