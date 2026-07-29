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
  /**
   * `"plain"` renders a bare number with no affix and no thousands grouping —
   * added for the Goals board's life-expectancy age, where a "$" or "%" would be
   * actively wrong and `formatDisplay`'s grouping would turn 110 into "110" only
   * by luck. Read-mode text still comes from `format` when one is passed.
   */
  mode?: "currency" | "percent" | "plain";
  className?: string;
  /**
   * Overrides the OPEN input's wrapper width. The 104px default is sized for a
   * currency amount; an age needs a third of that, and on the Goals board a
   * 104px field is wider than the card's whole detail line.
   */
  wrapperClassName?: string;
  /**
   * What the field holds, for the accessible names ("Edit {noun} for {label}" on
   * the trigger, "{Noun} for {label}" on the input). Defaults to `"amount"`,
   * which reproduces the original strings exactly — the Goals board's
   * life-expectancy editor holds an age, and calling that an "amount" to a screen
   * reader is simply wrong.
   */
  noun?: string;
  /**
   * Overrides the READ-mode display string only; the open input always shows the
   * raw number. Exists because the Household Map's Cash Flow board edits the
   * unsigned `annualAmount` while displaying outflows in accounting parens
   * ("($200,000)" via `moneyLabel`) — a display that cannot be derived from
   * `amount` alone, since `amount` carries no sign. Not a styling hook; pass
   * `className` for that.
   */
  format?: (n: number) => string;
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

/**
 * Everything that varies by mode, in one table, so a fourth mode is a data row
 * rather than another level of nesting in two unrelated expressions.
 *
 * `inputPad` is asymmetric on purpose: it has to clear whichever affix is
 * rendered, so percent mirrors currency rather than reusing `px-1.5`, which
 * would let a 4-character rate run under the `%`.
 */
const MODES = {
  currency: { read: currencyFmt, inputPad: "pl-4 pr-1.5" },
  percent: { read: percentFmt, inputPad: "pl-1.5 pr-5" },
  plain: { read: String, inputPad: "px-1.5" },
} as const;

export function InlineAmount({
  amount,
  onSave,
  label,
  mode = "currency",
  className,
  wrapperClassName,
  noun = "amount",
  format,
}: InlineAmountProps) {
  // Capitalised for the input, bare for the trigger — so the default `"amount"`
  // still yields the original "Edit amount for X" / "Amount for X" pair.
  const nounCap = noun.charAt(0).toUpperCase() + noun.slice(1);
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
          // BOTH are required, and they do different jobs. `stopPropagation`
          // keeps an ancestor's React onClick from firing; `preventDefault`
          // cancels the browser's DEFAULT action. On the Household Map this
          // button renders inside a `<Link>`, and an anchor navigates on the
          // default action — which `stopPropagation` does not touch. Without
          // the preventDefault, clicking the amount to edit it navigates away
          // to the Net Worth page instead. Harmless where there is no anchor:
          // a `type="button"` click has no default action of its own.
          e.preventDefault();
          e.stopPropagation();
          begin();
        }}
        className={
          className ??
          "min-w-[88px] rounded-sm px-1.5 py-0.5 text-right text-sm font-medium text-ink hover:bg-card-hover hover:ring-1 hover:ring-inset hover:ring-hair-2"
        }
        aria-label={`Edit ${noun} for ${label}`}
      >
        {(format ?? MODES[mode].read)(amount)}
      </button>
    );
  }

  return (
    <div
      className={wrapperClassName ?? "relative w-[104px]"}
      // Same pairing as the trigger above: clicking into the open input must
      // not navigate the enclosing `<Link>`. `preventDefault` on a CLICK does
      // not block focus (focus is decided on mousedown), so the field still
      // takes the caret.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
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
        className={`w-full rounded-sm border border-hair-2 bg-card-2 py-0.5 text-right text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-60 ${MODES[mode].inputPad}`}
        aria-label={`${nounCap} for ${label}`}
      />
      {mode === "percent" && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-ink-3">
          %
        </span>
      )}
    </div>
  );
}
