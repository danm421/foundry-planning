"use client";

// Click-to-edit <select> for a row cell. Read mode is a button showing
// `display`; activating swaps in a native <select> that closes on blur and
// dispatches on change.
//
// It deliberately does NOT know what a value means. The parent decides whether
// a pick saves immediately or ARMS a follow-up editor — that two-step is how
// the growth cell hosts a "Custom %" number input a <select> cannot contain,
// and how the year cell hosts "Custom year…". One component, four cells.
//
// Extracted from `growth-rate-cell.tsx`, whose accessible-name pair
// ("Change growth rate for X" on the trigger, "Growth rate for X" on the
// select) this reproduces exactly — see `label` below.
import { useState } from "react";

export interface InlineSelectOption {
  value: string;
  label: string;
}

export interface InlineSelectGroup {
  label: string;
  options: InlineSelectOption[];
}

export type InlineSelectItem = InlineSelectOption | InlineSelectGroup;

function isGroup(item: InlineSelectItem): item is InlineSelectGroup {
  return "options" in item;
}

export interface InlineSelectProps {
  /** Read-mode text. Not derived from `value` — the caller often has a richer
   *  label than the option list carries (e.g. "Retirement (2035)"). */
  display: string;
  /** Hover text for read mode. For a cell whose `display` is deliberately
   *  narrower than the value it stands for — a bare year standing in for
   *  "Client Retirement" — this is where the full meaning lives. */
  title?: string;
  /** Current `<select>` value. */
  value: string;
  options: InlineSelectItem[];
  /** Fires with the raw picked value. The parent decides save-vs-arm. */
  onSelect: (next: string) => void;
  /**
   * Lowercase noun phrase including the row name — "growth rate for IRA".
   * The trigger reads "Change {label}"; the open select reads {label} with its
   * first character capitalised. Keeping this one prop (rather than two full
   * strings) is what stops the two names drifting apart.
   */
  label: string;
  canEdit: boolean;
  className?: string;
  selectClassName?: string;
}

export function InlineSelect({
  display,
  title,
  value,
  options,
  onSelect,
  label,
  canEdit,
  className,
  selectClassName,
}: InlineSelectProps) {
  const [picking, setPicking] = useState(false);

  if (!canEdit) {
    return (
      <span title={title} className={className ?? "tabular text-[11px] text-ink-3"}>
        {display}
      </span>
    );
  }

  if (picking) {
    return (
      <select
        autoFocus
        aria-label={label.charAt(0).toUpperCase() + label.slice(1)}
        value={value}
        onBlur={() => setPicking(false)}
        onChange={(e) => {
          setPicking(false);
          onSelect(e.target.value);
        }}
        // BOTH are required and they do different jobs. `stopPropagation`
        // keeps an ancestor's React onClick from firing; `preventDefault`
        // cancels the browser's DEFAULT action — and these cells render inside
        // a <Link> on the Household Map, where an anchor navigates on the
        // default action, which `stopPropagation` does not touch.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className={
          selectClassName ??
          "rounded-sm border border-hair-2 bg-card-2 px-1 py-0.5 text-[11px] text-ink"
        }
      >
        {options.map((item) =>
          isGroup(item) ? (
            <optgroup key={item.label} label={item.label}>
              {item.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ),
        )}
      </select>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Change ${label}`}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPicking(true);
      }}
      className={
        className ??
        "rounded-sm px-1 py-0.5 tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      }
    >
      {display}
    </button>
  );
}
