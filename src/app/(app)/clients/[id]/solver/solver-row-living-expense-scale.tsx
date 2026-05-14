"use client";

import { useState } from "react";
import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";

interface Props {
  baseExpenses: ClientData["expenses"];
  onChange(m: SolverMutation): void;
}

export function SolverRowLivingExpenseScale({ baseExpenses, onChange }: Props) {
  const baseTotal = baseExpenses
    .filter((e) => e.type === "living")
    .reduce((s, e) => s + e.annualAmount, 0);
  const [pct, setPct] = useState(100);

  if (baseTotal === 0) return null;

  function commit(next: number) {
    setPct(next);
    onChange({ kind: "living-expense-scale", multiplier: next / 100 });
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Living Expenses</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-500">Annual (sum of living-type)</div>
          <div className="text-sm tabular-nums">${baseTotal.toLocaleString()}</div>
        </div>
        <div>
          <label className="block text-xs text-gray-500" htmlFor="living-scale">
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
            className="border border-gray-300 rounded px-2 py-1 text-sm w-24 tabular-nums"
          />
          <div className="text-xs text-gray-400 mt-1">
            Scaled annual: ${((baseTotal * pct) / 100).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}
