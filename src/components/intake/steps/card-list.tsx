"use client";

import type { ReactNode } from "react";

// ─── Shared input/label tokens (mirrored from family-step) ───────────────────
export const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent";
export const labelCls =
  "block text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3 mb-1";
export const selectCls = inputCls;

// ─── RemoveButton ─────────────────────────────────────────────────────────────

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Remove"
      className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-hair hover:text-crit"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="M2 2l10 10M12 2L2 12" />
      </svg>
      <span className="sr-only">Remove {label}</span>
    </button>
  );
}

// ─── CardList ─────────────────────────────────────────────────────────────────
//
// Generic add/remove list of cards.
//
// Props:
//   heading       — section eyebrow (e.g. "Accounts")
//   addLabel      — button label (e.g. "Add account")
//   emptyMessage  — shown when list is empty
//   items         — the array currently in state
//   onAdd         — called with no args; caller appends a new blank item
//   onRemove      — called with the index to drop
//   renderItem    — render the card body for item[i]; must NOT include the
//                   wrapper div — CardList provides it

export interface CardListProps<T> {
  heading: string;
  addLabel: string;
  emptyMessage: string;
  items: T[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderItem: (item: T, index: number) => ReactNode;
}

export function CardList<T>({
  heading,
  addLabel,
  emptyMessage,
  items,
  onAdd,
  onRemove,
  renderItem,
}: CardListProps<T>) {
  return (
    <div className="space-y-6">
      {/* ── Section heading + Add button ──────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
          {heading}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-[var(--radius-sm)] border border-hair px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
        >
          {addLabel}
        </button>
      </div>

      {/* ── Empty state ───────────────────────────────────────────── */}
      {items.length === 0 && (
        <p className="text-[13px] text-ink-4">{emptyMessage}</p>
      )}

      {/* ── Item cards ────────────────────────────────────────────── */}
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="relative rounded-[var(--radius-sm)] border border-hair bg-card p-4"
            >
              <RemoveButton label={`item ${i + 1}`} onRemove={() => onRemove(i)} />
              {renderItem(item, i)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
