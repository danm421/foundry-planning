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
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-[calc(100%-2rem)] rounded-lg border border-hair bg-card p-6 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-[16px] font-semibold text-ink">
          Save solver state as scenario
        </h2>

        <label className="mb-1.5 block text-[12px] text-ink-3" htmlFor="solver-save-name">
          Name
        </label>
        <input
          id="solver-save-name"
          className="h-9 w-full rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Retire at 67 with cuts"
        />

        <div className="mt-5 mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
          Includes {mutations.length} change{mutations.length === 1 ? "" : "s"}
        </div>
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-hair bg-paper/60 px-3 py-2 text-[13px] text-ink-2">
          {mutations.map((m, i) => (
            <li key={i} className="tabular">
              <span className="text-ink-4">›</span> {describeMutation(m)}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-hair-2 bg-card px-3 text-[13px] font-medium text-ink-2 hover:bg-card-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={name.trim().length === 0}
            onClick={() => onSubmit({ name: name.trim() })}
            className="h-9 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
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
