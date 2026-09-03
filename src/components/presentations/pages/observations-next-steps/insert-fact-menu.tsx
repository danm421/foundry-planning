"use client";
import { useEffect, useRef, useState } from "react";
import {
  previewLibraryEntry,
  type ObservationLibraryEntry,
} from "@/lib/plan-text/observation-library";
import { TOPIC_LABELS } from "@/lib/schemas/observations";

interface Props {
  entries: ObservationLibraryEntry[];
  tokenValues: Record<string, string | null> | null;
  onInsert: (entry: ObservationLibraryEntry) => void;
}

/** The library as a menu: each row is the entry's label and the sentence it
 *  would insert, with today's figures filled in ("…" while they load). */
export function InsertFactMenu({ entries, tokenValues, onInsert }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-hair px-2.5 py-1 text-[12px] font-medium text-ink-2 hover:border-accent hover:text-accent"
      >
        Insert a fact
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute left-0 z-20 mt-1 max-h-80 w-[28rem] overflow-y-auto rounded-lg border border-hair bg-card p-1 shadow-lg"
        >
          {entries.map((entry) => (
            <li key={entry.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onInsert(entry);
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-card-2"
              >
                <span className="text-[13px] font-medium text-ink">
                  {entry.label}
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-3">
                    {TOPIC_LABELS[entry.topic]}
                  </span>
                </span>
                <span className="text-[12px] text-ink-3">{previewLibraryEntry(entry, tokenValues)}</span>
              </button>
            </li>
          ))}
          {entries.length === 0 && (
            <li role="none" className="px-2 py-1.5 text-[12px] text-ink-3">
              Nothing to insert — every fact here needs a figure this plan doesn&apos;t have.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
