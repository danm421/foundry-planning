"use client";

import { useCallback, useRef, useState } from "react";
import type { MatchAnnotation } from "@/lib/imports/types";
import { ChevronDown } from "@/components/balance-sheet/icons";
import MatchLinkPicker, {
  type MatchCandidate,
  type MatchEntityKind,
} from "./match-link-picker";

interface MatchColumnProps {
  match: MatchAnnotation | undefined;
  /** Display name for the existing canonical row (when kind="exact"). */
  existingName?: string;
  /**
   * Picker candidates for the fuzzy state. Each candidate's id should
   * match an existing canonical row. The picker is also used to convert
   * "new" → "exact" via free re-link.
   */
  candidates?: MatchCandidate[];
  entityKind: MatchEntityKind;
  onChange?: (next: MatchAnnotation) => void;
  /** Disable interactivity (read-only contexts: committed imports, etc.). */
  readOnly?: boolean;
}

const TONE: Record<string, string> = {
  exact: "bg-good/15 text-good border-good/30",
  fuzzy: "bg-cat-life/15 text-cat-life border-cat-life/30",
  new: "bg-cat-portfolio/15 text-cat-portfolio border-cat-portfolio/30",
};

const LABEL: Record<string, string> = {
  exact: "✓ Matched",
  fuzzy: "⚠ Ambiguous",
  new: "✚ New",
};

export default function MatchColumn({
  match,
  existingName,
  candidates = [],
  entityKind,
  onChange,
  readOnly,
}: MatchColumnProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const kind = match?.kind ?? "new";

  const badge = (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${TONE[kind]}`}
    >
      {LABEL[kind]}
      {kind === "exact" && existingName ? (
        <span className="ml-1 truncate text-ink-2">{existingName}</span>
      ) : null}
    </span>
  );

  if (readOnly || !onChange) return badge;

  const handlePick = (next: MatchAnnotation) => {
    setPickerOpen(false);
    onChange(next);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md p-0.5 text-ink-3 hover:bg-card-2 hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
      >
        {badge}
        <span className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`}>
          <ChevronDown />
        </span>
      </button>
      {pickerOpen ? (
        <MatchLinkPicker
          anchorRef={triggerRef}
          currentMatch={match}
          candidates={candidates}
          entityKind={entityKind}
          onPick={handlePick}
          onClose={closePicker}
        />
      ) : null}
    </>
  );
}
