"use client";

import type { MonthlyMode } from "@/lib/solver/monthly-distributions";
import { BasisButton } from "./solver-monthly-shared";

/** Cash flow / Distributions, shared by both Monthly panels. */
export function MonthlyModeSwitch({
  mode,
  onChange,
}: {
  mode: MonthlyMode;
  onChange: (m: MonthlyMode) => void;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label="Monthly report view"
    >
      <BasisButton
        label="Cash flow"
        active={mode === "cashflow"}
        onClick={() => onChange("cashflow")}
      />
      <BasisButton
        label="Distributions"
        active={mode === "distributions"}
        onClick={() => onChange("distributions")}
      />
    </div>
  );
}
