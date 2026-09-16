"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchAnnotation } from "@/lib/imports/types";

export type MatchEntityKind =
  | "account"
  | "income"
  | "expense"
  | "liability"
  | "lifePolicy"
  | "entity"
  | "familyMember"
  | "will";

export interface MatchCandidate {
  id: string;
  name: string;
  /** Optional secondary text rendered under the name (e.g. "401(k) — Fidelity"). */
  subtitle?: string;
  /**
   * Pre-formatted headline figure for the existing row — its value — shown
   * opposite the name. Formatted by the caller rather than here: this picker
   * is shared by accounts, policies, incomes and expenses, and only the caller
   * knows whether the figure is a balance, a premium or an annual amount.
   */
  amount?: string;
  /** Optional fuzzy match score (0-1); shown when present. */
  score?: number;
}

interface MatchLinkPickerProps {
  currentMatch: MatchAnnotation | undefined;
  candidates: MatchCandidate[];
  entityKind: MatchEntityKind;
  onPick: (next: MatchAnnotation) => void;
  onClose: () => void;
}

export default function MatchLinkPicker({
  currentMatch,
  candidates,
  onPick,
  onClose,
}: MatchLinkPickerProps) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside dismiss.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.subtitle?.toLowerCase().includes(q) ?? false),
    );
  }, [candidates, query]);

  const currentExistingId =
    currentMatch?.kind === "exact" ? currentMatch.existingId : null;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-20 mt-1 w-96 max-w-[calc(100vw-2rem)] rounded border border-hair bg-card-2 shadow-lg"
      role="dialog"
    >
      <div className="border-b border-hair p-2">
        <input
          autoFocus
          type="text"
          placeholder="Search existing rows…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-hair bg-card px-2 py-1 text-sm text-ink"
        />
      </div>

      <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-xs text-ink-4">No candidates.</li>
        ) : null}
        {filtered.map((c) => {
          const selected = c.id === currentExistingId;
          return (
            <li key={c.id} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() =>
                  onPick({ kind: "exact", existingId: c.id })
                }
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-card ${
                  selected ? "bg-accent/10" : ""
                }`}
              >
                {/* Name and value on one line, the value right-aligned and
                    tabular: picking the right account by hand is mostly a
                    matter of recognising the balance, so it reads as a figure
                    rather than as more of the subtitle. */}
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-ink">{c.name}</span>
                  {c.amount ? (
                    <span className="tabular shrink-0 text-ink-2">{c.amount}</span>
                  ) : null}
                </span>
                {/* Conditional as a whole: the wills, insurance and dependent
                    pickers build candidates with neither a subtitle nor a
                    score, and an unconditional row gives every one of their
                    options a blank second line. */}
                {c.subtitle || typeof c.score === "number" ? (
                  <span className="flex w-full items-baseline justify-between gap-3">
                    <span className="min-w-0 text-xs text-ink-4">{c.subtitle}</span>
                    {typeof c.score === "number" ? (
                      <span className="shrink-0 font-mono text-xs text-ink-4">
                        {(c.score * 100).toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-hair p-2">
        <button
          type="button"
          onClick={() => onPick({ kind: "new" })}
          className="w-full rounded border border-hair bg-card px-2 py-1 text-left text-sm text-ink-2 hover:border-accent hover:text-accent"
        >
          ✚ Create as new
        </button>
      </div>
    </div>
  );
}
