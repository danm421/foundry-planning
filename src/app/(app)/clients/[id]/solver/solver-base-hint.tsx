"use client";

import type { ReactNode } from "react";

interface Props<T> {
  base: T;
  working: T;
  /** Renders the base value for display. Defaults to String(base). */
  format?: (v: T) => ReactNode;
  /** When provided, renders a "· reset" affordance that clears this field. */
  onReset?: () => void;
  /** Override the changed check (e.g. tolerance for floats). Default !Object.is. */
  changed?: boolean;
}

/** Inline "base was X · reset" hint. Renders null when the value is unchanged. */
export function SolverBaseHint<T>({ base, working, format, onReset, changed }: Props<T>) {
  const isChanged = changed ?? !Object.is(base, working);
  if (!isChanged) return null;
  return (
    <div className="mt-0.5 text-[11px] text-ink-4">
      base was <span className="text-ink-3 tabular">{format ? format(base) : String(base)}</span>
      {onReset ? (
        <>
          {" · "}
          <button
            type="button"
            onClick={onReset}
            className="text-accent hover:underline focus-visible:outline-none focus-visible:underline"
          >
            reset
          </button>
        </>
      ) : null}
    </div>
  );
}
