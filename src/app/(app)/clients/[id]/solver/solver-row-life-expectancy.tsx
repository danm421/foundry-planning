"use client";

import { useState } from "react";
import type { ClientData } from "@/engine";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
  type SolverPerson,
} from "@/lib/solver/types";
import { SolverBaseHint } from "./solver-base-hint";

interface Props {
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}

export function SolverRowLifeExpectancy({
  baseClient,
  workingClient,
  onChange,
  onResetField,
}: Props) {
  const showSpouse = baseClient.spouseLifeExpectancy != null;

  const nowYear = new Date().getFullYear();
  const ageFromDob = (dob: string | null | undefined): number => {
    if (!dob) return 1;
    const birthYear = Number(String(dob).slice(0, 4));
    return Number.isFinite(birthYear) ? Math.max(1, nowYear - birthYear) : 1;
  };
  const clientMinLE = ageFromDob(workingClient.dateOfBirth);
  const spouseMinLE = ageFromDob(workingClient.spouseDob);

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Life Expectancy</div>
      <div className="space-y-2.5">
        <Editable
          id="le-client"
          label={`${workingClient.firstName}'s Life Expectancy`}
          value={workingClient.lifeExpectancy ?? 95}
          base={baseClient.lifeExpectancy ?? 95}
          min={clientMinLE}
          max={110}
          person="client"
          onCommit={(v) =>
            onChange({ kind: "life-expectancy", person: "client", age: v })
          }
          onResetField={onResetField}
        />
        {showSpouse ? (
          <Editable
            id="le-spouse"
            label={`${workingClient.spouseName ?? "Spouse"}'s Life Expectancy`}
            value={workingClient.spouseLifeExpectancy ?? 93}
            base={baseClient.spouseLifeExpectancy ?? 93}
            min={spouseMinLE}
            max={110}
            person="spouse"
            onCommit={(v) =>
              onChange({ kind: "life-expectancy", person: "spouse", age: v })
            }
            onResetField={onResetField}
          />
        ) : null}
      </div>
    </div>
  );
}

function Editable({
  id,
  label,
  value,
  base,
  min,
  max,
  person,
  onCommit,
  onResetField,
}: {
  id: string;
  label: string;
  value: number;
  base: number;
  min: number;
  max: number;
  person: SolverPerson;
  onCommit: (v: number) => void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  // Bumps on reset to remount the uncontrolled input so its defaultValue
  // re-applies from the reverted base value (defaultValue only takes on mount).
  const [resetTick, setResetTick] = useState(0);
  return (
    <div>
      <label className="block text-[11px] text-ink-3" htmlFor={id}>
        {label}
      </label>
      <input
        key={`${id}-${resetTick}`}
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
      <SolverBaseHint
        base={base}
        working={value}
        onReset={
          onResetField
            ? () => {
                onResetField([
                  mutationKey({ kind: "life-expectancy", person, age: 0 }),
                ]);
                setResetTick((t) => t + 1);
              }
            : undefined
        }
      />
    </div>
  );
}
