"use client";

import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { activeSavingsRules } from "@/lib/solver/active-savings-rules";
import { useSolverSide } from "./solver-section";

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
  const side = useSolverSide();
  const baseActive = activeSavingsRules(baseClientData.savingsRules, currentYear);
  if (baseActive.length === 0) return null;

  return (
    <div className="space-y-2.5 col-span-2">
      <div className="text-[13px] font-medium text-ink">Savings Contributions</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
        {baseActive.map((baseRule) => {
          const account = baseClientData.accounts.find((a) => a.id === baseRule.accountId);
          const label = account?.name ?? baseRule.accountId.slice(0, 6);
          if (side === "base") {
            return (
              <ReadOnly key={baseRule.id} label={label} value={baseRule.annualAmount} />
            );
          }
          const workingRule =
            workingClientData.savingsRules.find((r) => r.id === baseRule.id) ?? baseRule;
          return (
            <Editable
              key={baseRule.id}
              id={`s-${baseRule.id}`}
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
          );
        })}
      </div>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3 truncate">{label}</div>
      <div className="mt-0.5 text-[15px] text-ink-2 tabular">${value.toLocaleString()}</div>
    </div>
  );
}

function Editable({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] text-ink-3 truncate" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={10_000_000}
        step={1000}
        defaultValue={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= 0) onCommit(n);
        }}
        className="mt-1 h-9 w-32 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        aria-label={label}
      />
    </div>
  );
}
