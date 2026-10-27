"use client";

// Small pieces the "New trust" wizard steps share: the step bar, a step's
// title block, radio-style choice rows, switch rows and the accent callout.
// Presentational only — each step owns its own answers.

import { useId, type ReactNode } from "react";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** The numbered progress strip. `current` is an index into `steps`. */
export function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-3.5 flex items-center gap-1.5 text-[11.5px] text-ink-4">
      {steps.map((label, i) => {
        const done = i < current;
        const cur = i === current;
        return (
          <li key={label} className="flex items-center gap-1.5" aria-current={cur ? "step" : undefined}>
            {i > 0 ? <span aria-hidden className="h-px w-3 bg-hair-2" /> : null}
            <span
              aria-hidden
              className={`flex h-[17px] w-[17px] items-center justify-center rounded-full border text-[9.5px] ${
                done
                  ? "border-accent bg-accent text-accent-on"
                  : cur
                    ? "border-accent text-accent"
                    : "border-hair-2"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={cur ? "font-medium text-ink" : done ? "text-ink-3" : undefined}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h4 className="text-[15.5px] font-semibold text-ink">{title}</h4>
      {subtitle ? <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{subtitle}</p> : null}
    </div>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 mt-2.5 text-[10.5px] uppercase tracking-[0.12em] text-ink-4">
      {children}
    </div>
  );
}

/** One radio row: name, optional impact tag, one-line description. Put it
 *  inside a `role="radiogroup"`. */
export function ChoiceRow({
  name,
  description,
  tag,
  checked,
  onSelect,
}: {
  name: string;
  description?: string;
  tag?: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`mb-1.5 flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors ${focusRing} ${
        checked ? "border-accent bg-accent-wash" : "border-hair hover:border-hair-2"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border ${
          checked ? "border-[4px] border-accent" : "border-hair-2"
        }`}
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">
          {name}
          {tag ? (
            <span className="ml-1.5 rounded-[3px] bg-card-2 px-1.5 py-px align-[1px] text-[10px] font-normal text-ink-3">
              {tag}
            </span>
          ) : null}
        </span>
        {description ? (
          <span className="block text-[11.5px] leading-snug text-ink-3">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

/** A switch with its name, a one-line note, an optional control underneath
 *  (`children`) and an optional "why it's on" line. */
export function SwitchRow({
  name,
  note,
  why,
  checked,
  onToggle,
  children,
}: {
  name: string;
  note: string;
  why?: string | null;
  checked: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 border-b border-hair py-2.5 last:border-b-0">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-note`}
        onClick={onToggle}
        className={`relative mt-px h-[17px] w-[30px] shrink-0 rounded-full transition-colors ${focusRing} ${
          checked ? "bg-accent" : "bg-hair-2"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-[2px] h-[13px] w-[13px] rounded-full transition-all ${
            checked ? "left-[15px] bg-accent-on" : "left-[2px] bg-card"
          }`}
        />
      </button>
      <div className="min-w-0">
        <div id={`${id}-name`} className="text-[13px] font-medium text-ink">
          {name}
        </div>
        <div id={`${id}-note`} className="mt-0.5 text-[12px] leading-snug text-ink-3">
          {note}
        </div>
        {children}
        {why ? <div className="mt-1 text-[11.5px] text-accent-ink">{why}</div> : null}
      </div>
    </div>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-[var(--radius-sm)] border border-hair border-l-[3px] border-l-accent bg-card-2 px-3 py-2 text-[12px] leading-snug text-ink-2">
      {children}
    </div>
  );
}
