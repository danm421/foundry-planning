"use client";

import type { ReactNode } from "react";

interface Props {
  leftHeader: ReactNode;
  rightHeader: ReactNode;
  children: ReactNode;
}

export function SolverCompareGrid({ leftHeader, rightHeader, children }: Props) {
  return (
    <div className="rounded-lg border border-hair bg-card overflow-hidden">
      <div className="grid grid-cols-2 bg-card-2/50 border-b border-hair">
        <div className="px-5 py-4 border-r border-hair">{leftHeader}</div>
        <div className="px-5 py-4">{rightHeader}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}
