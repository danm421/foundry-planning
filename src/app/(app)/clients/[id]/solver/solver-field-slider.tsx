"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Slider from "@radix-ui/react-slider";

interface SolverFieldSliderProps {
  id: string;
  /** Accessible name for the value, slider, and edit input. */
  label: string;
  value: number;
  /** Slider track bounds (thumb clamps here). */
  min: number;
  max: number;
  step?: number;
  /** Display formatter for the editable value. Default: localized integer. */
  format?: (n: number) => string;
  /** Compact formatter for the min/max end labels. Default: same as `format`. */
  formatBound?: (n: number) => string;
  /** Symbol shown before the value (e.g. "$"). */
  prefix?: string;
  /** Upper clamp for a typed value, when it may exceed the slider's `max`. */
  valueMax?: number;
  onCommit: (n: number) => void;
  /** Inline control rendered to the right of the value (e.g. a Solve button). */
  trailing?: ReactNode;
}

const localeInt = (n: number) => Math.round(n).toLocaleString();
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * A value + slider control: the number reads as a clean mono label, click it to
 * type an exact value, drag the slider for quick what-ifs. The component is
 * controlled by `value` — the solver's working tree reverts synchronously on
 * reset, so the thumb follows without a remount.
 */
export function SolverFieldSlider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  format = localeInt,
  formatBound,
  prefix,
  valueMax,
  onCommit,
  trailing,
}: SolverFieldSliderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hi = valueMax ?? max;
  const bound = formatBound ?? format;
  const thumb = clamp(value, min, max);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [editing]);

  // `draft` holds raw digits; the input formats them for display only, so commit
  // parses directly without re-stripping separators.
  function startEdit() {
    setDraft(String(Math.round(value)));
    setEditing(true);
  }

  function onDraftChange(raw: string) {
    setDraft(raw.replace(/[^\d]/g, ""));
  }

  function commitDraft() {
    if (draft !== "") onCommit(clamp(parseInt(draft, 10), min, hi));
    setEditing(false);
  }

  return (
    <div>
      <div className="flex min-h-[2rem] items-center gap-2">
        {editing ? (
          <div className="relative">
            {prefix ? (
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-ink-3">
                {prefix}
              </span>
            ) : null}
            <input
              ref={inputRef}
              id={id}
              type="text"
              inputMode="numeric"
              value={draft === "" ? "" : format(parseInt(draft, 10))}
              aria-label={label}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraft();
                else if (e.key === "Escape") setEditing(false);
              }}
              onBlur={commitDraft}
              className={`h-8 w-[7.5rem] rounded-md border border-accent bg-card-2 ${
                prefix ? "pl-6 pr-2.5" : "px-2.5"
              } text-[18px] font-medium text-ink tabular focus:outline-none focus:ring-2 focus:ring-accent/30`}
            />
          </div>
        ) : (
          <button
            type="button"
            id={id}
            onClick={startEdit}
            aria-label={`Edit ${label}`}
            className="group/val -mx-1.5 inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[18px] font-medium leading-none text-ink tabular transition hover:bg-card-2"
          >
            {prefix ? <span className="text-[14px] text-ink-3">{prefix}</span> : null}
            <span>{format(value)}</span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="ml-1 h-3 w-3 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover/val:opacity-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M11 2.5 13.5 5 5.5 13 3 13.5 3.5 11z" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {trailing}
      </div>

      <div className="mt-2">
        <Slider.Root
          className="relative flex h-4 w-full touch-none select-none items-center"
          value={[thumb]}
          min={min}
          max={max}
          step={step}
          onValueChange={(next) => {
            const n = next[0];
            if (typeof n === "number") onCommit(n);
          }}
        >
          <Slider.Track className="relative h-1 w-full grow rounded-full bg-hair-2">
            <Slider.Range className="absolute h-full rounded-full bg-accent" />
          </Slider.Track>
          <Slider.Thumb
            className="block h-4 w-4 rounded-full border-2 border-accent bg-paper shadow-sm transition hover:border-accent-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
            aria-label={label}
          />
        </Slider.Root>
        <div className="mt-1 flex justify-between text-[10px] text-ink-4 tabular">
          <span>{bound(min)}</span>
          <span>{bound(max)}</span>
        </div>
      </div>
    </div>
  );
}
