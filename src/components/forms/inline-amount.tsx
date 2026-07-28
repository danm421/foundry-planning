"use client";

// Click-to-edit number for a row. Renders the formatted value as a button; on
// activation swaps in a compact input that commits on Enter or blur and cancels
// on Escape. `onSave` returns whether the write succeeded so the field stays
// calm on success and the parent can revert on failure.
//
// Extracted from `income-expenses-view.tsx` (symbol `InlineAmount`) so the
// Household Map reuses it rather than forking it. `mode: "percent"` drives the
// growth-rate editor; the value there is a PERCENT (6.2), not a decimal —
// callers convert.
//
// EXTRACTION FIDELITY (controller resolution R12). The plan authorised ONE
// change to the extracted markup: raw `gray-*` utilities become design-system
// tokens, because the original predates them. Everything else is preserved
// deliberately, including three things the plan's own snippet dropped without
// saying so — the trigger's `min-w-[88px]` (without it the Income & Expenses
// amount column reflows as values change), the input's `aria-label` (a
// `getByRole("textbox")` query passes with no label at all, so nothing else
// catches its loss), and the input's focus/disabled styling. If you are here to
// restyle, pass `className` from the call site instead of editing the defaults.
import { useEffect, useRef, useState } from "react";
import { cleanInput, formatDisplay } from "@/components/currency-input";

export interface InlineAmountProps {
  amount: number;
  onSave: (next: number) => Promise<boolean>;
  label: string;
  mode?: "currency" | "percent";
  className?: string;
}

// Must stay behaviourally identical to the `fmt` helper this component was
// extracted alongside (`income-expenses-view.tsx`, symbol `fmt`). `Intl`
// currency style renders a negative as "-$1,000"; a hand-rolled
// `$${n.toLocaleString()}` would render "$-1,000" and silently change the
// Income & Expenses page.
const currencyFmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const percentFmt = (n: number) => `${n.toFixed(2)}%`;

export function InlineAmount({
  amount,
  onSave,
  label,
  mode = "currency",
  className,
}: InlineAmountProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function begin() {
    setDraft(amount ? String(amount) : "");
    setEditing(true);
  }

  async function commit() {
    if (saving) return;
    const next = Number(cleanInput(draft) || "0");
    if (!Number.isFinite(next) || next === amount) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await onSave(next);
    setSaving(false);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          begin();
        }}
        className={
          className ??
          "min-w-[88px] rounded-sm px-1.5 py-0.5 text-right text-sm font-medium text-ink hover:bg-card-hover hover:ring-1 hover:ring-inset hover:ring-hair-2"
        }
        aria-label={`Edit amount for ${label}`}
      >
        {mode === "percent" ? percentFmt(amount) : currencyFmt(amount)}
      </button>
    );
  }

  return (
    <div className="relative w-[104px]" onClick={(e) => e.stopPropagation()}>
      {mode === "currency" && (
        <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">
          $
        </span>
      )}
      <input
        ref={inputRef}
        inputMode="decimal"
        value={mode === "currency" ? formatDisplay(draft) : draft}
        disabled={saving}
        onChange={(e) => setDraft(cleanInput(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        // Padding is asymmetric on purpose: it has to clear whichever affix is
        // rendered, so percent mirrors currency rather than reusing `px-1.5`,
        // which would let a 4-character rate run under the `%`.
        className={`w-full rounded-sm border border-hair-2 bg-card-2 py-0.5 text-right text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-60 ${
          mode === "currency" ? "pl-4 pr-1.5" : "pl-1.5 pr-5"
        }`}
        aria-label={`Amount for ${label}`}
      />
      {mode === "percent" && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">
          %
        </span>
      )}
    </div>
  );
}
