// src/app/(app)/clients/[id]/solver/solver-solve-popover.tsx
"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  rangeLabel: string;
  defaultTargetPct: number;
  open: boolean;
  onClose: () => void;
  onSubmit: (targetPoS: number) => void;
}

export function SolverSolvePopover({
  title,
  rangeLabel,
  defaultTargetPct,
  open,
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState<number>(defaultTargetPct);
  const [prevOpen, setPrevOpen] = useState(open);
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue(defaultTargetPct);
  }

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isValid = value >= 1 && value <= 99;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={title}
      className="absolute z-50 mt-1 w-64 rounded-md border border-hair-2 bg-card p-3 shadow-lg"
    >
      <div className="text-[12px] font-medium text-ink">{title}</div>
      <div className="mt-2 text-[11px] text-ink-3">Target PoS</div>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={99}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) setValue(n);
          }}
          className="h-8 w-20 rounded-md border border-hair-2 bg-card-2 px-2 text-[14px] text-ink tabular focus:outline-none focus:border-accent"
          aria-label="Target Probability of Success percent"
        />
        <span className="text-[12px] text-ink-3">%</span>
      </div>
      <div className="mt-2 text-[11px] text-ink-3">Range: {rangeLabel}</div>
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
          className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Solve
        </button>
      </div>
    </div>
  );
}
