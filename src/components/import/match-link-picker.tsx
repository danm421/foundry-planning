"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
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
  /** The control that opened the picker. The picker is placed against it, and
   *  a press on it is the trigger's own toggle, not an outside click. */
  anchorRef: RefObject<HTMLElement | null>;
  currentMatch: MatchAnnotation | undefined;
  candidates: MatchCandidate[];
  /** Names the rows in the picker's wording ("Search existing accounts…",
   *  "Create as new account"). A caller whose rows are none of these kinds —
   *  most of the fact finder's — passes none, and the picker says "record". */
  entityKind?: MatchEntityKind;
  onPick: (next: MatchAnnotation) => void;
  onClose: () => void;
}

/** [singular, plural] — for the search placeholder, empty state and the
 *  "Create as new" button. */
const NOUN: Record<MatchEntityKind, [string, string]> = {
  account: ["account", "accounts"],
  income: ["income", "incomes"],
  expense: ["expense", "expenses"],
  liability: ["liability", "liabilities"],
  lifePolicy: ["policy", "policies"],
  entity: ["entity", "entities"],
  familyMember: ["family member", "family members"],
  will: ["will", "wills"],
};

const WIDTH = 384;
const GUTTER = 8;
const MAX_HEIGHT = 400;

interface Placement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Left-aligned under the trigger, slid back inside the window when it would
 *  overflow, and flipped above when there is more room there. */
function placeAgainst(anchor: DOMRect): Placement {
  const width = Math.min(WIDTH, window.innerWidth - GUTTER * 2);
  const left = Math.min(
    Math.max(GUTTER, anchor.left),
    window.innerWidth - width - GUTTER,
  );
  const below = window.innerHeight - anchor.bottom - GUTTER;
  const above = anchor.top - GUTTER;
  return below < 240 && above > below
    ? { left, width, bottom: window.innerHeight - anchor.top + 4, maxHeight: Math.min(MAX_HEIGHT, above - 4) }
    : { left, width, top: anchor.bottom + 4, maxHeight: Math.min(MAX_HEIGHT, below - 4) };
}

export default function MatchLinkPicker({
  anchorRef,
  currentMatch,
  candidates,
  entityKind,
  onPick,
  onClose,
}: MatchLinkPickerProps) {
  const [query, setQuery] = useState("");
  const [placement, setPlacement] = useState<Placement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [one, many] = entityKind ? NOUN[entityKind] : ["record", "records"];

  // Portaled to <body> and fixed against the trigger. Rendered in place it
  // hung off the trigger's right edge, so a trigger near the left of the
  // review card opened the list underneath the app sidebar. Re-placed on any
  // scroll (capture: the review pane scrolls, not the window) so it stays
  // attached — except its own list scrolling, which moves nothing.
  useLayoutEffect(() => {
    const place = (e?: Event) => {
      if (e && ref.current?.contains(e.target as Node)) return;
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const next = placeAgainst(r);
      // Most scrolls elsewhere on the page don't move the trigger — keep the
      // same object so React skips the re-render.
      setPlacement((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    // Captured and stopped: the onboarding import drawer closes on a window
    // Escape, and one keypress meant for the picker took the drawer with it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchorRef, onClose]);

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

  if (!placement) return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Link to an existing ${one}`}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-hair bg-card shadow-lg"
      style={placement}
    >
      <div className="border-b border-hair p-2">
        <input
          autoFocus
          type="text"
          aria-label={`Search existing ${many}`}
          placeholder={`Search existing ${many}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Only once something is typed — a stray Enter on the bare list
            // would otherwise link the row to whatever happens to be first.
            if (e.key === "Enter" && query.trim() && filtered[0]) {
              e.preventDefault();
              onPick({ kind: "exact", existingId: filtered[0].id });
            }
          }}
          className="w-full rounded-md border border-hair bg-card-2 px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
        {filtered.length === 0 ? (
          <li className="px-3 py-3 text-[13px] text-ink-3">
            {candidates.length === 0
              ? `No existing ${many} to link.`
              : `No ${many} match “${query.trim()}”.`}
          </li>
        ) : null}
        {filtered.map((c) => {
          const selected = c.id === currentExistingId;
          return (
            <li key={c.id} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => onPick({ kind: "exact", existingId: c.id })}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-card-2 ${
                  selected ? "bg-accent-wash" : ""
                }`}
              >
                {/* Name and value on one line, the value right-aligned and
                    tabular: picking the right account by hand is mostly a
                    matter of recognising the balance, so it reads as a figure
                    rather than as more of the subtitle. */}
                <span className="flex w-full items-baseline justify-between gap-3 text-[13px]">
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
                  <span className="flex w-full items-baseline justify-between gap-3 text-xs text-ink-3">
                    <span className="min-w-0">{c.subtitle}</span>
                    {typeof c.score === "number" ? (
                      <span className="tabular shrink-0">
                        {(c.score * 100).toFixed(0)}% match
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-hair p-1">
        <button
          type="button"
          onClick={() => onPick({ kind: "new" })}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:bg-card-2 hover:text-ink"
        >
          <span aria-hidden className="text-ink-3">+</span>
          Create as new {one}
        </button>
      </div>
    </div>,
    document.body,
  );
}
