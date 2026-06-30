// src/components/forms/field-hint-popover.tsx
"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** One row in the hint box. Omit `term` for a value-only (bare-tag) row. */
export type HintRow = { term?: string; value: string };

const GAP = 8; // px between badge and box
const MARGIN = 8; // px viewport inset

/**
 * Inline `?` badge that reveals a small box of `term → value` rows on hover or
 * keyboard focus. The box renders in a `document.body` portal and is
 * `position: fixed`, placed to the right of the badge (flipping left / clamping
 * near a viewport edge). The portal is required because the solver's left column
 * is `overflow-y-auto`, which would clip an in-flow box opening sideways.
 */
export function FieldHintPopover({ label, rows }: { label: string; rows: HintRow[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setCoords(null);
  }, []);

  // Measure badge + box once open, place to the right (flip left / clamp at edges).
  useEffect(() => {
    if (!open) return;
    const badge = badgeRef.current;
    const panel = panelRef.current;
    if (!badge || !panel) return;
    const b = badge.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    let left = b.right + GAP;
    if (left + p.width > window.innerWidth - MARGIN) left = b.left - p.width - GAP;
    left = Math.max(MARGIN, left);
    let top = Math.min(b.top, window.innerHeight - MARGIN - p.height);
    top = Math.max(MARGIN, top);
    setCoords({ top, left });
  }, [open, rows]);

  // Close on Escape / scroll / resize while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (rows.length === 0) return null;

  return (
    <span
      className="inline-flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
    >
      <button
        ref={badgeRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? panelId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={close}
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-ink-3 text-[10px] font-semibold leading-none text-ink-2 hover:border-ink-2 hover:text-ink focus:border-ink-2 focus:text-ink focus:outline-none"
      >
        ?
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="tooltip"
              style={{
                position: "fixed",
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
                opacity: coords ? 1 : 0,
              }}
              className="pointer-events-none z-50 w-max max-w-[calc(100vw-1rem)] rounded-md border border-hair-2 bg-card px-3 py-2 text-xs leading-snug text-ink-2 shadow-lg transition-opacity motion-reduce:transition-none"
            >
              <dl className="grid grid-cols-[auto_auto] items-baseline gap-x-5 gap-y-1">
                {rows.map((r, i) =>
                  r.term ? (
                    <Fragment key={i}>
                      <dt className="text-ink-3">{r.term}</dt>
                      <dd className="tabular text-ink-2">{r.value}</dd>
                    </Fragment>
                  ) : (
                    <dd key={i} className="col-span-2 text-ink-2">
                      {r.value}
                    </dd>
                  ),
                )}
              </dl>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
