"use client";

import { useState } from "react";
import type { ClientData } from "@/engine";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
  type SolverPerson,
} from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { SolverBaseHint } from "./solver-base-hint";
import { SolverFieldSlider } from "./solver-field-slider";
import { SolverSolveIcon } from "./solver-solve-icon";
import { SolverSolvePopover } from "./solver-solve-popover";
import { SolverSolveProgressStrip } from "./solver-solve-progress-strip";

type ActiveSolve = {
  target: SolveLeverKey;
  targetPoS?: number;
  iteration: number;
  candidateValue: number | null;
  achievedPoS: number | null;
};

const RETIREMENT_AGE_SOLVE_DESCRIPTION =
  "Finds the retirement age that reaches your target probability of success, holding spending and savings fixed.";

interface Props {
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
  onSolveCancel: () => void;
}

export function SolverRowRetirementAges({
  baseClient,
  workingClient,
  onChange,
  onResetField,
  activeSolve,
  onSolveStart,
  onSolveCancel,
}: Props) {
  const showSpouse = baseClient.spouseRetirementAge != null;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Retirement Ages</div>
      <div className="space-y-4">
        <EditableWithSolve
          id="ra-client"
          label={`${workingClient.firstName}'s Retirement Age`}
          value={workingClient.retirementAge}
          base={baseClient.retirementAge}
          min={40}
          max={85}
          person="client"
          activeSolve={activeSolve}
          onSolveStart={onSolveStart}
          onSolveCancel={onSolveCancel}
          onCommit={(v) =>
            onChange({ kind: "retirement-age", person: "client", age: v })
          }
          onResetField={onResetField}
        />
        {showSpouse ? (
          <EditableWithSolve
            id="ra-spouse"
            label={`${workingClient.spouseName ?? "Spouse"}'s Retirement Age`}
            value={workingClient.spouseRetirementAge ?? 65}
            base={baseClient.spouseRetirementAge ?? 65}
            min={40}
            max={85}
            person="spouse"
            activeSolve={activeSolve}
            onSolveStart={onSolveStart}
            onSolveCancel={onSolveCancel}
            onCommit={(v) =>
              onChange({ kind: "retirement-age", person: "spouse", age: v })
            }
            onResetField={onResetField}
          />
        ) : null}
      </div>
    </div>
  );
}

function EditableWithSolve({
  id,
  label,
  value,
  base,
  min,
  max,
  person,
  activeSolve,
  onSolveStart,
  onSolveCancel,
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
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
  onSolveCancel: () => void;
  onCommit: (v: number) => void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const target: SolveLeverKey = { kind: "retirement-age", person };
  const isSolvingHere =
    activeSolve?.target.kind === "retirement-age" &&
    (activeSolve.target as { kind: "retirement-age"; person: SolverPerson }).person === person;
  const otherSolveActive = activeSolve !== null && !isSolvingHere;

  if (isSolvingHere) {
    return (
      <div>
        <div className="text-[11px] text-ink-3 mb-1">{label}</div>
        <SolverSolveProgressStrip
          title={`Solving ${label} for ${Math.round(activeSolve.targetPoS! * 100)}% PoS`}
          iteration={activeSolve.iteration}
          maxIterations={8}
          candidateValue={activeSolve.candidateValue}
          achievedPoS={activeSolve.achievedPoS}
          valueFormatter={(v) => `${v}`}
          onCancel={onSolveCancel}
        />
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1.5 block text-[11px] text-ink-3" htmlFor={id}>
        {label}
      </label>
      <SolverFieldSlider
        id={id}
        label={label}
        value={value}
        min={min}
        max={max}
        onCommit={onCommit}
        trailing={
          <div className="relative">
            <SolverSolveIcon
              label={`Solve ${label}`}
              tooltip={RETIREMENT_AGE_SOLVE_DESCRIPTION}
              disabled={otherSolveActive}
              onClick={() => setPopoverOpen(true)}
            />
            {popoverOpen ? (
              <SolverSolvePopover
                title={`Solve ${label}`}
                rangeLabel="50–80"
                defaultTargetPct={85}
                open={popoverOpen}
                onClose={() => setPopoverOpen(false)}
                onSubmit={(targetPoS) => {
                  setPopoverOpen(false);
                  onSolveStart(target, targetPoS);
                }}
              />
            ) : null}
          </div>
        }
      />
      <SolverBaseHint
        base={base}
        working={value}
        onReset={
          onResetField
            ? () =>
                onResetField([
                  mutationKey({ kind: "retirement-age", person, age: 0 }),
                ])
            : undefined
        }
      />
    </div>
  );
}
