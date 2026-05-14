"use client";

import { useState } from "react";
import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { useSolverSide } from "./solver-section";

interface Props {
  baseExpenses: ClientData["expenses"];
  onChange(m: SolverMutation): void;
}

export function SolverRowLivingExpenseScale({ baseExpenses, onChange }: Props) {
  const side = useSolverSide();
  const baseTotal = baseExpenses
    .filter((e) => e.type === "living")
    .reduce((s, e) => s + e.annualAmount, 0);
  const [pct, setPct] = useState(100);

  if (baseTotal === 0) return null;

  function commit(next: number) {
    setPct(next);
    onChange({ kind: "living-expense-scale", multiplier: next / 100 });
  }

  if (side === "base") {
    return (
      <div className="space-y-2.5">
        <div className="text-[13px] font-medium text-ink">Living Expenses</div>
        <div>
          <div className="text-[11px] text-ink-3">Annual (sum of living-type)</div>
          <div className="mt-0.5 text-[15px] text-ink-2 tabular">
            ${baseTotal.toLocaleString()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Living Expenses</div>
      <div>
        <label className="block text-[11px] text-ink-3" htmlFor="living-scale">
          Scale (%)
        </label>
        <input
          id="living-scale"
          aria-label="Living expense scale"
          type="number"
          min={50}
          max={150}
          step={1}
          value={pct}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n) && n >= 50 && n <= 150) commit(n);
          }}
          className="mt-1 h-9 w-24 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <div className="mt-1.5 text-[11px] text-ink-4">
          Scaled annual:{" "}
          <span className="text-ink-3 tabular">
            ${((baseTotal * pct) / 100).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
