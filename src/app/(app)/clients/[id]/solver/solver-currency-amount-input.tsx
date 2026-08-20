"use client";

import { useEffect, useState } from "react";

/** Compact $-prefixed currency input with live thousands formatting, used by the
 *  solver's two-across input grids.
 *
 *  The typed text is staged locally so a half-typed figure keeps its formatting,
 *  then re-synced whenever `value` moves underneath it — that is how a row whose
 *  amount was changed somewhere else (its edit dialog, a per-field reset) shows
 *  the new figure. Typing is unaffected: each keystroke commits, so `value`
 *  already equals what is on screen by the time the sync runs. */
export function CurrencyAmountInput({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [display, setDisplay] = useState<string>(Math.round(value).toLocaleString());
  useEffect(() => {
    setDisplay(Math.round(value).toLocaleString());
  }, [value]);
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const n = raw === "" ? 0 : parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return;
    setDisplay(n.toLocaleString());
    onCommit(n);
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        className="h-9 w-32 rounded-md border border-hair-2 bg-card-2 pl-6 pr-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        aria-label={label}
      />
    </div>
  );
}
