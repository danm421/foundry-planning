"use client";
// src/components/fact-finder/cell-editor.tsx
// One editable fact finder cell: the input for its column kind, a × that pins
// it empty, where a document value came from, "Check this", and the highlight
// for cells the last chat reply changed. Every edit is one op through
// `onApply`; a refused edit (false) shows the stored value again.
import { useContext, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import { inputCompactClassName, selectChevronClassName, textareaClassName } from "@/components/forms/input-styles";
import type { ClientOp } from "@/lib/fact-finder/ops";
import type { ColumnKind, FFColumn } from "@/lib/fact-finder/schema";
import { cellNeedsCheck, isBlank } from "@/lib/fact-finder/state";
import type { FFCell } from "@/lib/fact-finder/types";
import { ViewOnlyContext } from "./holdings-rows";
import { AlertIcon, CloseIcon } from "./icons";

export interface CellEditorProps {
  sectionId: string;
  rowId: string;
  column: FFColumn;
  cell: FFCell | undefined;
  /** `useFactFinder`'s `apply`: false when the edit was refused. */
  onApply: (ops: ClientOp[]) => boolean;
  /** Changed by the last chat reply. */
  highlighted: boolean;
  /** Uploaded file id → its name; undefined once the file is gone. */
  fileName: (fileId: string) => string | undefined;
}

/** The source note's gap from its cell, and the least room it leaves at the window's edge. */
const NOTE_GAP = 4;
const NOTE_EDGE = 8;

const NUMBER_KEYPAD: Partial<Record<ColumnKind, "decimal" | "numeric">> = {
  number: "decimal",
  integer: "numeric",
  year: "numeric",
};

/** The stored value as an input shows it ("" when blank). */
function textOf(cell: FFCell | undefined): string {
  const value = cell?.value;
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}

export function CellEditor({ sectionId, rowId, column, cell, onApply, highlighted, fileName }: CellEditorProps) {
  const id = useId();
  // A read-only screen: no clear button (a disabled one still shows its faint ×).
  const viewOnly = useContext(ViewOnlyContext);
  // What the advisor is typing; null = show the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  // Where the source note shows: `fixed` under the cell (above it when the
  // window has no room below), so a table that scrolls sideways never clips
  // it. Set on hover/focus; any scroll hides it.
  const [notePlace, setNotePlace] = useState<CSSProperties | null>(null);
  const note = useRef<HTMLDivElement>(null);
  const placed = notePlace !== null;
  useEffect(() => {
    if (!placed) return;
    const hide = () => setNotePlace(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [placed]);
  const placeNote = (e: SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // The note is laid out (hidden) the whole time, so its real height is known.
    const height = note.current?.getBoundingClientRect().height ?? 0;
    const below = r.bottom + NOTE_GAP;
    const top = below + height <= window.innerHeight - NOTE_EDGE ? below : Math.max(NOTE_EDGE, r.top - NOTE_GAP - height);
    setNotePlace({ top, left: Math.max(NOTE_EDGE, Math.min(r.left, window.innerWidth - 264)) });
  };
  const stored = textOf(cell);
  const shown = draft ?? stored;
  const target = { sectionId, rowId, columnId: column.id };
  const set = (value: string | true) => onApply([{ op: "setCell", ...target, value }]);
  const clear = () => onApply([{ op: "clearCell", ...target }]);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const next = draft.trim();
    if (next === stored) return;
    if (next === "") clear();
    else set(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") setDraft(null);
    else if (e.key === "Enter" && e.currentTarget.tagName !== "TEXTAREA") commit();
  };

  const blank = isBlank(cell?.value);
  const needsCheck = cellNeedsCheck(cell);
  const source = blank ? undefined : cell?.source;
  const describedBy =
    [needsCheck && `${id}-check`, source && `${id}-source`, highlighted && `${id}-changed`]
      .filter(Boolean)
      .join(" ") || undefined;
  const named = { "aria-label": column.label, "aria-describedby": describedBy };
  const typing = { ...named, onBlur: commit, onKeyDown };
  // A document value that wouldn't parse stays text until it's corrected.
  const kind: ColumnKind = cell?.issue === "unparsed" ? "text" : column.kind;

  let editor: ReactNode;
  switch (kind) {
    case "money":
      editor = <CurrencyInput {...typing} compact value={shown} onChange={setDraft} className="tabular text-right" />;
      break;
    case "percent":
      editor = <PercentInput {...typing} compact value={shown} onChange={setDraft} className="tabular text-right" />;
      break;
    case "date":
    case "monthYear":
      editor = (
        <input
          {...typing}
          type={kind === "date" ? "date" : "month"}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          className={`${inputCompactClassName} tabular`}
        />
      );
      break;
    case "choice": {
      const options = column.options ?? [];
      const offList = stored !== "" && !options.includes(stored);
      editor = (
        <select
          {...named}
          value={stored}
          onChange={(e) => {
            if (e.target.value === stored) return;
            if (e.target.value === "") clear();
            else set(e.target.value);
          }}
          className={`${inputCompactClassName} ${selectChevronClassName}`}
        >
          <option value="">—</option>
          {offList && (
            <option value={stored} disabled>
              {`${stored} — pick one`}
            </option>
          )}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "check":
      editor = (
        <span className="flex h-8 items-center">
          <input
            {...named}
            type="checkbox"
            checked={cell?.value === true}
            onChange={(e) => (e.target.checked ? set(true) : clear())}
            className="h-4 w-4 cursor-pointer rounded accent-accent"
          />
        </span>
      );
      break;
    case "notes":
      editor = (
        <textarea
          {...typing}
          rows={2}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          className={`${textareaClassName} resize-y`}
        />
      );
      break;
    default: {
      const keypad = NUMBER_KEYPAD[kind];
      editor = (
        <input
          {...typing}
          type="text"
          inputMode={keypad}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          className={keypad ? `${inputCompactClassName} tabular text-right` : inputCompactClassName}
        />
      );
    }
  }

  return (
    <div
      onMouseEnter={source ? placeNote : undefined}
      onFocus={source ? placeNote : undefined}
      className={`group relative min-w-0 rounded-[var(--radius-sm)] ${highlighted ? "ring-2 ring-secondary/50" : ""}`}
    >
      {editor}
      {!blank && !viewOnly && column.kind !== "check" && (
        <button
          type="button"
          aria-label={`Clear ${column.label}`}
          title="Clear — reading documents again won't refill it"
          onClick={clear}
          className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-hair-2 bg-card text-ink-3 opacity-0 transition-opacity hover:border-crit/40 hover:text-crit group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      )}
      {needsCheck && (
        <span
          id={`${id}-check`}
          className="mt-1 inline-flex items-center gap-1 rounded border border-warn/30 bg-warn/15 px-1.5 py-0.5 text-[11px] font-medium text-warn"
        >
          <AlertIcon className="h-3 w-3" />
          Check this
        </span>
      )}
      {source && (
        <div
          ref={note}
          id={`${id}-source`}
          role="tooltip"
          style={notePlace ?? undefined}
          className={`pointer-events-none invisible fixed z-30 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-hair bg-card px-3 py-2 text-xs leading-snug text-ink-2 opacity-0 shadow-lg transition-[opacity,visibility] ${
            placed
              ? "group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 group-hover:delay-300"
              : ""
          }`}
        >
          <p className="font-medium text-ink">
            From {fileName(source.fileId) ?? source.documentName ?? "a removed document"}
            {source.page !== undefined && (
              <>
                , page <span className="tabular">{source.page}</span>
              </>
            )}
          </p>
          {source.snippet && <p className="mt-1 line-clamp-3 text-ink-3">“{source.snippet}”</p>}
          {cell?.confidence !== undefined && (
            <p className="mt-1">
              Confidence <span className="tabular">{Math.round(cell.confidence * 100)}%</span>
            </p>
          )}
        </div>
      )}
      {highlighted && (
        <span id={`${id}-changed`} className="sr-only">
          Changed by the last chat reply
        </span>
      )}
    </div>
  );
}
