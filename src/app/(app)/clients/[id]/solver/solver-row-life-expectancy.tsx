"use client";

import type { ClientData } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";

interface Props {
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
}

export function SolverRowLifeExpectancy({ baseClient, workingClient, onChange }: Props) {
  const showSpouse = baseClient.spouseLifeExpectancy != null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Life Expectancy</div>

      <div className="grid grid-cols-2 gap-4">
        <ReadOnly label={`${baseClient.firstName}'s Life Expectancy`} value={baseClient.lifeExpectancy ?? null} />
        <Editable
          label={`${workingClient.firstName}'s Life Expectancy`}
          value={workingClient.lifeExpectancy ?? 95}
          min={70}
          max={110}
          onCommit={(v) =>
            onChange({ kind: "life-expectancy", person: "client", age: v })
          }
        />
      </div>

      {showSpouse ? (
        <div className="grid grid-cols-2 gap-4">
          <ReadOnly
            label={`${baseClient.spouseName ?? "Spouse"}'s Life Expectancy`}
            value={baseClient.spouseLifeExpectancy ?? null}
          />
          <Editable
            label={`${workingClient.spouseName ?? "Spouse"}'s Life Expectancy`}
            value={workingClient.spouseLifeExpectancy ?? 93}
            min={70}
            max={110}
            onCommit={(v) =>
              onChange({ kind: "life-expectancy", person: "spouse", age: v })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm tabular-nums">{value ?? "—"}</div>
    </div>
  );
}

function Editable({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500" htmlFor={label}>
        {label}
      </label>
      <input
        id={label}
        type="number"
        min={min}
        max={max}
        defaultValue={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n) && n >= min && n <= max) onCommit(n);
        }}
        className="border border-gray-300 rounded px-2 py-1 text-sm w-24 tabular-nums"
        aria-label={label}
      />
    </div>
  );
}
