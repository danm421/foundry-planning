"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface SolverFieldStepperProps {
  id: string;
  /** Accessible name for the value and its edit input. */
  label: string;
  value: number;
  /** Hard clamp: the step buttons stop here and typed values are pinned to it. */
  min: number;
  max: number;
  step?: number;
  /** Display formatter for the value. Default: localized integer. */
  format?: (n: number) => string;
  /** Symbol shown before the value (e.g. "$"). */
  prefix?: string;
  onCommit: (n: number) => void;
  /** Inline control rendered to the right of the stepper (e.g. a Solve button). */
  trailing?: ReactNode;
}

const localeInt = (n: number) => Math.round(n).toLocaleString();
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** Page Up/Down move in coarser jumps than the arrow keys. */
const PAGE_MULTIPLIER = 10;

/** Keys that nudge the value, in multiples of `step`. */
const KEY_STEP_MULTIPLIER: Record<string, number> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
  PageUp: PAGE_MULTIPLIER,
  PageDown: -PAGE_MULTIPLIER,
};

const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 125;
const REPEAT_FAST_INTERVAL_MS = 62;
/** Ticks at the base cadence before the repeat accelerates. */
const REPEAT_TICKS_BEFORE_FAST = 12;

/**
 * A value with a minus/plus stepper: click either side to move one increment,
 * hold to repeat, or click the number to type an exact figure. The component is
 * controlled by `value` — the solver's working tree reverts synchronously on
 * reset, so the reading follows without a remount.
 */
export function SolverFieldStepper({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  format = localeInt,
  prefix,
  onCommit,
  trailing,
}: SolverFieldStepperProps) {
  // `null` means "not editing"; a string is the live draft. One piece of state
  // rather than two, so there is no way to leave a stale draft behind.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement>(null);

  const reading = `${prefix ?? ""}${format(value)}`;

  // Deliberately not memoized: a held repeat re-reads this through StepButton's
  // latest-callback ref, so it has to be rebuilt against the newest `value` on
  // every render. Wrapping it in useCallback would pin the repeat to whatever
  // the value was when the hold started.
  function stepBy(delta: number) {
    const next = clamp(value + delta, min, max);
    if (next !== value) onCommit(next);
  }

  // Reserve enough room for the field's own magnitude so the pill doesn't
  // resize as digits come and go. A `max` that exists only as a safety rail
  // (10M on a spending field) shouldn't stretch every dollar cell, so the
  // reservation is capped and longer values simply grow the pill.
  const valueWidth = `calc(${Math.min(format(max).length, 8) + (prefix ? 1 : 0)}ch + 1.5rem)`;

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
  }

  function commitDraft() {
    if (draft) onCommit(clamp(parseInt(draft, 10), min, max));
    setDraft(null);
  }

  function onValueKeyDown(e: React.KeyboardEvent) {
    const multiplier = KEY_STEP_MULTIPLIER[e.key];
    if (multiplier === undefined) return;
    e.preventDefault();
    stepBy(step * multiplier);
  }

  return (
    <div className="flex min-h-[2.75rem] items-center gap-2">
      <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-[10px] border border-hair bg-card-2">
        <StepButton
          direction={-1}
          label={`Decrease ${label}`}
          // Stepping mid-edit would race the input's own commit, and the typed
          // value is the more specific intent — let it land first.
          disabled={editing || value <= min}
          onStep={() => stepBy(-step)}
        />

        {editing ? (
          <div className="relative flex items-center" style={{ width: valueWidth }}>
            {prefix ? (
              <span className="pointer-events-none absolute left-3 text-[14px] text-ink-3">
                {prefix}
              </span>
            ) : null}
            <input
              ref={inputRef}
              id={id}
              type="text"
              inputMode="numeric"
              value={draft ? format(parseInt(draft, 10)) : ""}
              aria-label={label}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraft();
                else if (e.key === "Escape") setDraft(null);
              }}
              onBlur={commitDraft}
              className={`h-full w-full bg-transparent text-center ${
                prefix ? "pl-5 pr-2" : "px-2"
              } text-[20px] font-medium text-ink tabular focus:outline-none`}
            />
          </div>
        ) : (
          <button
            type="button"
            id={id}
            role="spinbutton"
            aria-label={label}
            aria-valuenow={value}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={reading}
            onClick={startEdit}
            onKeyDown={onValueKeyDown}
            style={{ width: valueWidth }}
            className="inline-flex items-center justify-center px-3 py-2 text-[20px] font-medium leading-none text-ink tabular transition hover:bg-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          >
            {prefix ? <span className="text-[14px] text-ink-3">{prefix}</span> : null}
            <span>{format(value)}</span>
          </button>
        )}

        <StepButton
          direction={1}
          label={`Increase ${label}`}
          disabled={editing || value >= max}
          onStep={() => stepBy(step)}
        />
      </div>
      {trailing}
    </div>
  );
}

function StepButton({
  direction,
  label,
  disabled,
  onStep,
}: {
  direction: 1 | -1;
  label: string;
  disabled: boolean;
  onStep: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A pointer press steps on pointerdown for an immediate feel, so the click it
  // generates on release has to be swallowed. Keyboard activation raises a click
  // with no preceding pointerdown, which is how Enter/Space still step.
  const steppedOnPointerRef = useRef(false);

  // Latest-callback ref: each repeat tick calls the newest `onStep`, which is
  // closed over the value from the most recent commit rather than the one that
  // was on screen when the hold began.
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  });

  function stopRepeat() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  // Unmount only. Reading the ref inside keeps this off `stopRepeat`'s
  // per-render identity, which would otherwise cancel a live hold on every
  // re-render — and a hold re-renders on every tick.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // A self-rescheduling timeout rather than an interval, so the cadence can
  // tighten once the user has clearly settled into a hold.
  function startRepeat() {
    let ticks = 0;
    const schedule = (delay: number) => {
      timerRef.current = setTimeout(() => {
        ticks += 1;
        onStepRef.current();
        schedule(ticks >= REPEAT_TICKS_BEFORE_FAST ? REPEAT_FAST_INTERVAL_MS : REPEAT_INTERVAL_MS);
      }, delay);
    };
    schedule(REPEAT_DELAY_MS);
  }

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        steppedOnPointerRef.current = true;
        onStep();
        startRepeat();
      }}
      onPointerUp={stopRepeat}
      onPointerLeave={stopRepeat}
      onPointerCancel={stopRepeat}
      onClick={() => {
        if (steppedOnPointerRef.current) {
          steppedOnPointerRef.current = false;
          return;
        }
        onStep();
      }}
      className={`grid h-11 w-11 shrink-0 place-items-center text-ink-3 transition hover:bg-card-hover hover:text-ink active:bg-accent-wash active:text-accent-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:pointer-events-none disabled:text-ink-4 disabled:opacity-40 ${
        direction === 1 ? "border-l border-hair" : "border-r border-hair"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        {direction === 1 ? <path d="M12 5v14M5 12h14" /> : <path d="M5 12h14" />}
      </svg>
    </button>
  );
}
