"use client";

import { useState } from "react";
import { fmtUsd } from "@/lib/tax-analysis/format";

/** "$1,234" / "(6,141)" / "-6141" / " 12.5 " → number; "" / "-" / junk → null. */
export function parseMoneyInput(raw: string): number | null {
  let s = raw.trim();
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = "-" + paren[1];
  s = s.replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Money input for the facts review form: formatted ($124,624 / -$6,141)
 *  when blurred, raw digits while focused. Empty → null, matching the
 *  nullable-money facts schema. */
export function MoneyField({
  value,
  onChange,
  className,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  // Non-null exactly while focused: holds the user's raw text so partial
  // states like "1,23" survive re-renders; blurred display derives from value.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={
        className ??
        "w-36 rounded border border-hair bg-transparent px-2 py-1 text-right tabular-nums"
      }
      value={draft ?? (value == null ? "" : fmtUsd(value))}
      onFocus={() => setDraft(value == null ? "" : String(value))}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseMoneyInput(e.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
