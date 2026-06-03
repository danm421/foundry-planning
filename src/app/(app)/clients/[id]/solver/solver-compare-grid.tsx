"use client";

import type { ReactNode } from "react";

interface Props {
  leftHeader: ReactNode;
  rightHeader: ReactNode;
  children: ReactNode;
}

export function SolverCompareGrid({ leftHeader, rightHeader, children }: Props) {
  return (
    <div className="rounded-lg border border-hair bg-card">
      <div className="grid grid-cols-2 overflow-hidden rounded-t-lg bg-card-2/50 border-b border-hair">
        <div className="min-w-0 px-5 py-4 border-r border-hair">{leftHeader}</div>
        <div className="min-w-0 px-5 py-4">{rightHeader}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}
