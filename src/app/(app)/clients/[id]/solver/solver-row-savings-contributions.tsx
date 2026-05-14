"use client";

import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { activeSavingsRules } from "@/lib/solver/active-savings-rules";

interface Props {
  baseClientData: ClientData;
  workingClientData: ClientData;
  currentYear: number;
  onChange(m: SolverMutation): void;
}

export function SolverRowSavingsContributions({
  baseClientData,
  workingClientData,
  currentYear,
  onChange,
}: Props) {
  const baseActive = activeSavingsRules(baseClientData.savingsRules, currentYear);
  if (baseActive.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Savings Contributions</div>
      {baseActive.map((baseRule) => {
        const workingRule =
          workingClientData.savingsRules.find((r) => r.id === baseRule.id) ?? baseRule;
        const account = baseClientData.accounts.find((a) => a.id === baseRule.accountId);
        const label = account?.name ?? baseRule.accountId.slice(0, 6);
        return (
          <div key={baseRule.id} className="grid grid-cols-2 gap-4">
            <ReadOnly label={label} value={baseRule.annualAmount} />
            <Editable
              label={label}
              value={workingRule.annualAmount}
              onCommit={(v) =>
                onChange({
                  kind: "savings-contribution",
                  accountId: baseRule.accountId,
                  annualAmount: v,
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm tabular-nums">${value.toLocaleString()}</div>
    </div>
  );
}

function Editable({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500" htmlFor={`s-${label}`}>
        {label}
      </label>
      <input
        id={`s-${label}`}
        type="number"
        min={0}
        max={10_000_000}
        step={1000}
        defaultValue={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= 0) onCommit(n);
        }}
        className="border border-gray-300 rounded px-2 py-1 text-sm w-32 tabular-nums"
        aria-label={label}
      />
    </div>
  );
}
