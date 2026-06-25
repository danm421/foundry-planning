"use client";

import { useState, type ReactNode } from "react";
import { cleanInput, formatDisplay } from "@/components/currency-input";

// ─── Shared input/label tokens (consumed by every intake step) ───────────────
export const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 text-[14px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent";
export const labelCls =
  "block text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3 mb-1";
export const selectCls = inputCls;

// ─── MoneyInput ───────────────────────────────────────────────────────────────
//
// Dollar field that formats with a "$" prefix + thousands separators as you
// type (e.g. 50000 → "$50,000"), reusing the app's shared currency helpers but
// styled to match the intake form. Keeps an internal raw string so partial
// entries ("50000.", "0") survive while the numeric value flows up via onChange.

export function MoneyInput({
  id,
  value,
  onChange,
  ariaLabel,
  placeholder,
}: {
  id?: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  // Keep an internal raw string so partial entries survive (e.g. a trailing
  // "." while typing "1234.50"). Re-sync from the prop only when `value` truly
  // changes externally — re-render with the same numeric value (our own echo)
  // is a no-op, which is what preserves the in-progress decimal. This is React's
  // documented "adjust state during render on prop change" pattern.
  const [raw, setRaw] = useState(value === undefined ? "" : String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setRaw(value === undefined ? "" : String(value));
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-3">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className={`${inputCls} pl-7 tabular`}
        value={formatDisplay(raw)}
        onChange={(e) => {
          const cleaned = cleanInput(e.target.value);
          setRaw(cleaned);
          const num = cleaned === "" || cleaned === "." ? undefined : Number(cleaned);
          setPrevValue(num);
          onChange(num);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}

// ─── RemoveButton ─────────────────────────────────────────────────────────────

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="absolute right-3 top-3 flex items-center gap-1 rounded-[var(--radius-sm)] border border-hair px-2 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 transition-colors hover:border-crit hover:text-crit"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 14 14"
        fill="none"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d="M2 2l10 10M12 2L2 12" />
      </svg>
      Remove
      <span className="sr-only">{label}</span>
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
