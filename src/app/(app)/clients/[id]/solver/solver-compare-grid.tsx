"use client";

import type { ReactNode } from "react";

interface Props {
  leftHeader: ReactNode;
  rightHeader: ReactNode;
  children: ReactNode;
}

export function SolverCompareGrid({ leftHeader, rightHeader, children }: Props) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-2 border-b border-gray-200">
        <div className="p-4 border-r border-gray-200">{leftHeader}</div>
        <div className="p-4">{rightHeader}</div>
      </div>
      <div>{children}</div>
    </div>
  );
}
