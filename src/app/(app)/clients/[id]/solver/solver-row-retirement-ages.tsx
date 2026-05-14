"use client";

import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { useSolverSide } from "./solver-section";

interface Props {
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
}

export function SolverRowRetirementAges({ baseClient, workingClient, onChange }: Props) {
  const side = useSolverSide();
  const showSpouse = baseClient.spouseRetirementAge != null;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Retirement Ages</div>
      {side === "base" ? (
        <div className="space-y-2.5">
          <ReadOnly
            label={`${baseClient.firstName}'s Retirement Age`}
            value={baseClient.retirementAge}
          />
          {showSpouse ? (
            <ReadOnly
              label={`${baseClient.spouseName ?? "Spouse"}'s Retirement Age`}
              value={baseClient.spouseRetirementAge ?? null}
            />
          ) : null}
        </div>
      ) : (
        <div className="space-y-2.5">
          <Editable
            id="ra-client"
            label={`${workingClient.firstName}'s Retirement Age`}
            value={workingClient.retirementAge}
            min={40}
            max={85}
            onCommit={(v) =>
              onChange({ kind: "retirement-age", person: "client", age: v })
            }
          />
          {showSpouse ? (
            <Editable
              id="ra-spouse"
              label={`${workingClient.spouseName ?? "Spouse"}'s Retirement Age`}
              value={workingClient.spouseRetirementAge ?? 65}
              min={40}
              max={85}
              onCommit={(v) =>
                onChange({ kind: "retirement-age", person: "spouse", age: v })
              }
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-[15px] text-ink-2 tabular">{value ?? "—"}</div>
    </div>
  );
}

function Editable({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] text-ink-3" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= min && n <= max) onCommit(n);
        }}
        className="mt-1 h-9 w-24 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        aria-label={label}
      />
    </div>
  );
}
