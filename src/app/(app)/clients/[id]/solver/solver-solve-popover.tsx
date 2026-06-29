// src/app/(app)/clients/[id]/solver/solver-solve-popover.tsx
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FieldTooltip } from "@/components/forms/field-tooltip";

const MIN_TARGET_PCT = 1;
const MAX_TARGET_PCT = 100;
const GAP = 4; // px between trigger and popover
const MARGIN = 8; // px viewport inset

interface Props {
  title: string;
  rangeLabel: string;
  defaultTargetPct: number;
  open: boolean;
  /** Trigger element the popover hangs off of (used to position the portal). */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (targetPoS: number) => void;
}

export function SolverSolvePopover({
  title,
  rangeLabel,
  defaultTargetPct,
  open,
  anchorRef,
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState<number>(defaultTargetPct);
  const [prevOpen, setPrevOpen] = useState(open);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue(defaultTargetPct);
  }

  // The solver's left column is `overflow-y-auto`, which clips an in-flow box —
  // so the popover renders in a `document.body` portal and is `position: fixed`,
  // placed under the trigger (flipping up / clamping near a viewport edge). This
  // lets it overlay the report panel instead of being cut off behind it.
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    let left = a.left;
    if (left + p.width > window.innerWidth - MARGIN) left = a.right - p.width;
    left = Math.max(MARGIN, left);
    let top = a.bottom + GAP;
    if (top + p.height > window.innerHeight - MARGIN) top = a.top - p.height - GAP;
    top = Math.max(MARGIN, top);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot layout measurement on open; coords isn't a dep so there's no cascade.
    setCoords({ top, left });
  }, [open, anchorRef]);

  // Close on outside click / Escape / scroll / resize while open.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  const isValid = value >= MIN_TARGET_PCT && value <= MAX_TARGET_PCT;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        opacity: coords ? 1 : 0,
      }}
      className="z-50 w-64 rounded-md border border-hair-2 bg-card p-3 shadow-lg transition-opacity motion-reduce:transition-none"
    >
      <div className="text-[12px] font-medium text-ink">{title}</div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-ink-3">
        Target PoS
        <FieldTooltip text="Probability of Success — the share of simulated scenarios in which the plan doesn't run out of money. The solver searches for the value that reaches this target." />
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          min={MIN_TARGET_PCT}
          max={MAX_TARGET_PCT}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isNaN(n)) return;
            setValue(Math.min(MAX_TARGET_PCT, Math.max(MIN_TARGET_PCT, n)));
          }}
          className="h-8 w-20 rounded-md border border-hair-2 bg-card-2 px-2 text-[14px] text-ink tabular focus:outline-none focus:border-accent"
          aria-label="Target Probability of Success percent"
        />
        <span className="text-[12px] text-ink-3">%</span>
      </div>
      <div className="mt-2 text-[11px] text-ink-3">Search range: {rangeLabel}</div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[12px] text-ink-2 hover:border-hair"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!isValid}
          onClick={() => onSubmit(value / 100)}
          className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-on hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Solve
        </button>
      </div>
    </div>,
    document.body,
  );
}
