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
      className="absolute right-0 top-full z-20 mt-1 w-72 rounded border border-hair bg-card-2 shadow-lg"
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
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-card ${
                  selected ? "bg-accent/10" : ""
                }`}
              >
                <span className="flex flex-col">
                  <span className="text-ink">{c.name}</span>
                  {c.subtitle ? (
                    <span className="text-xs text-ink-4">{c.subtitle}</span>
                  ) : null}
                </span>
                {typeof c.score === "number" ? (
                  <span className="font-mono text-xs text-ink-4">
                    {(c.score * 100).toFixed(0)}%
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
