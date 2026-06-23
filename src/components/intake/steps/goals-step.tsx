"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import { inputCls, labelCls } from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GoalsSlice = IntakeDraft["goals"];

export interface GoalsStepProps {
  value: GoalsSlice;
  onChange: (next: GoalsSlice) => void;
}

// ─── GoalsStep ────────────────────────────────────────────────────────────────

export function GoalsStep({ value, onChange }: GoalsStepProps) {
  const goals = value ?? {};

  function setField(field: keyof NonNullable<GoalsSlice>, raw: string) {
    const num = raw === "" ? undefined : Number(raw);
    onChange({ ...goals, [field]: num });
  }

  return (
    <div className="space-y-6">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        Retirement goals
      </h2>

      <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Client retirement age */}
          <div>
            <label htmlFor="goals-clientRetirementAge" className={labelCls}>
              Client retirement age
              <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
            </label>
            <input
              id="goals-clientRetirementAge"
              type="number"
              min={40}
              max={100}
              className={`${inputCls} tabular`}
              value={goals.clientRetirementAge ?? ""}
              onChange={(e) => setField("clientRetirementAge", e.target.value)}
              placeholder="e.g. 65"
              aria-label="Client retirement age"
            />
          </div>

          {/* Spouse retirement age */}
          <div>
            <label htmlFor="goals-spouseRetirementAge" className={labelCls}>
              Spouse retirement age
              <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
            </label>
            <input
              id="goals-spouseRetirementAge"
              type="number"
              min={40}
              max={100}
              className={`${inputCls} tabular`}
              value={goals.spouseRetirementAge ?? ""}
              onChange={(e) => setField("spouseRetirementAge", e.target.value)}
              placeholder="e.g. 63"
              aria-label="Spouse retirement age"
            />
          </div>

          {/* Annual retirement expenses */}
          <div className="sm:col-span-2">
            <label htmlFor="goals-annualRetirementExpenses" className={labelCls}>
              Annual retirement expenses ($)
              <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
            </label>
            <input
              id="goals-annualRetirementExpenses"
              type="number"
              min={0}
              className={`${inputCls} tabular`}
              value={goals.annualRetirementExpenses ?? ""}
              onChange={(e) => setField("annualRetirementExpenses", e.target.value)}
              placeholder="e.g. 80,000"
              aria-label="Annual retirement expenses"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
