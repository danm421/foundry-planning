// src/components/tax-ledger/tax-ledger-year-picker.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export interface YearOption {
  year: number;
  ages: { client: number; spouse?: number };
}

/** Year selector for the Tax Ledger. Replaces a native <select> so the open
 *  list can be height-capped + scrollable (native dropdowns render a full-height
 *  OS menu over a 40-year projection) and each row can show the household ages
 *  in that year alongside the year. */
export default function TaxLedgerYearPicker({
  years,
  selectedYear,
  onSelect,
  clientName,
  spouseName,
}: {
  years: YearOption[];
  selectedYear: number | null;
  onSelect: (year: number) => void;
  clientName?: string;
  spouseName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    // Bring the active row into view when the list opens.
    selectedRef.current?.scrollIntoView({ block: "center" });
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function ageLabel(ages: { client: number; spouse?: number }) {
    const c = `${clientName?.trim() || "Client"} ${ages.client}`;
    if (ages.spouse == null) return c;
    return `${c} · ${spouseName?.trim() || "Spouse"} ${ages.spouse}`;
  }

  const selected = years.find((y) => y.year === selectedYear) ?? null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-hair bg-card px-2 py-1 text-ink"
      >
        <span className="tabular-nums font-medium">{selected?.year ?? "—"}</span>
        {selected && <span className="text-xs text-ink-3">{ageLabel(selected.ages)}</span>}
        <svg viewBox="0 0 12 12" className={`h-3 w-3 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-20 mt-1 max-h-72 w-max min-w-full overflow-y-auto rounded-md border border-hair bg-card py-1 shadow-lg"
        >
          {years.map((y) => {
            const active = y.year === selectedYear;
            return (
              <li key={y.year}>
                <button
                  ref={active ? selectedRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSelect(y.year);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm hover:bg-accent/10 ${
                    active ? "bg-accent/10 text-ink" : "text-ink-2"
                  }`}
                >
                  <span className="tabular-nums font-medium">{y.year}</span>
                  <span className="text-xs text-ink-3">{ageLabel(y.ages)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
