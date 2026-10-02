// src/app/(app)/clients/[id]/solver/solver-solve-popover.tsx
"use client";

import { useState, type RefObject } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { SolverAnchoredPopover } from "./solver-anchored-popover";

const MIN_TARGET_PCT = 1;
const MAX_TARGET_PCT = 100;

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

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue(defaultTargetPct);
  }

  if (!open) return null;

  const isValid = value >= MIN_TARGET_PCT && value <= MAX_TARGET_PCT;

  return (
    <SolverAnchoredPopover anchor={anchorRef} label={title} onClose={onClose} className="w-64 p-3">
      <div className="text-[12px] font-medium text-ink">{title}</div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-ink-3">
        Target confidence
        <FieldTooltip text="Plan Confidence — the share of simulated scenarios in which the plan stays funded. The solver searches for the value that reaches this target." />
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          data-autofocus
          min={MIN_TARGET_PCT}
          max={MAX_TARGET_PCT}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isNaN(n)) return;
            setValue(Math.min(MAX_TARGET_PCT, Math.max(MIN_TARGET_PCT, n)));
          }}
          className="h-8 w-20 rounded-md border border-hair-2 bg-card-2 px-2 text-[14px] text-ink tabular focus:outline-none focus:border-accent"
          aria-label="Target Plan Confidence percent"
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
    </SolverAnchoredPopover>
  );
}
