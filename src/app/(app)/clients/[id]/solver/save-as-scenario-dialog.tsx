"use client";

import { useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";

interface Props {
  open: boolean;
  mutations: SolverMutation[];
  onClose(): void;
  onSubmit(args: { name: string }): void;
}

export function SaveAsScenarioDialog({ open, mutations, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-[480px] max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-2">Save solver state as scenario</h2>

        <label className="block text-sm mb-1" htmlFor="solver-save-name">
          Name
        </label>
        <input
          id="solver-save-name"
          className="border border-gray-300 rounded px-2 py-1 w-full text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Retire at 67 with cuts"
        />

        <div className="text-xs text-gray-500 mt-4 mb-1">
          Includes {mutations.length} change{mutations.length === 1 ? "" : "s"}:
        </div>
        <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
          {mutations.map((m, i) => (
            <li key={i}>• {describeMutation(m)}</li>
          ))}
        </ul>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm border border-gray-300 rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={name.trim().length === 0}
            onClick={() => onSubmit({ name: name.trim() })}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Save scenario
          </button>
        </div>
      </div>
    </div>
  );
}

function describeMutation(m: SolverMutation): string {
  switch (m.kind) {
    case "retirement-age":
      return `Retirement age (${m.person}) → ${m.age}${
        m.month ? ` (month ${m.month})` : ""
      }`;
    case "living-expense-scale":
      return `Living expenses scaled × ${m.multiplier.toFixed(2)}`;
    case "ss-claim-age":
      return `SS claim age (${m.person}) → ${m.age}`;
    case "savings-contribution":
      return `Savings contribution (${m.accountId.slice(0, 8)}…) → $${m.annualAmount.toLocaleString()}`;
    case "life-expectancy":
      return `Life expectancy (${m.person}) → ${m.age}`;
  }
}
