"use client";

import { useState } from "react";
import type { ClientData } from "@/engine";
import type { SolverMutation, SolverPerson } from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { useSolverSide } from "./solver-section";
import { SolverSolveIcon } from "./solver-solve-icon";
import { SolverSolvePopover } from "./solver-solve-popover";
import { SolverSolveProgressStrip } from "./solver-solve-progress-strip";

type ActiveSolve = {
  target: SolveLeverKey;
  targetPoS: number;
  iteration: number;
  candidateValue: number | null;
  achievedPoS: number | null;
};

interface Props {
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
  onSolveCancel: () => void;
}

export function SolverRowRetirementAges({
  baseClient,
  workingClient,
  onChange,
  activeSolve,
  onSolveStart,
  onSolveCancel,
}: Props) {
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
          <EditableWithSolve
            id="ra-client"
            label={`${workingClient.firstName}'s Retirement Age`}
            value={workingClient.retirementAge}
            min={40}
            max={85}
            person="client"
            activeSolve={activeSolve}
            onSolveStart={onSolveStart}
            onSolveCancel={onSolveCancel}
            onCommit={(v) =>
              onChange({ kind: "retirement-age", person: "client", age: v })
            }
          />
          {showSpouse ? (
            <EditableWithSolve
              id="ra-spouse"
              label={`${workingClient.spouseName ?? "Spouse"}'s Retirement Age`}
              value={workingClient.spouseRetirementAge ?? 65}
              min={40}
              max={85}
              person="spouse"
              activeSolve={activeSolve}
              onSolveStart={onSolveStart}
              onSolveCancel={onSolveCancel}
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

function EditableWithSolve({
  id,
  label,
  value,
  min,
  max,
  person,
  activeSolve,
  onSolveStart,
  onSolveCancel,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  person: SolverPerson;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
  onSolveCancel: () => void;
  onCommit: (v: number) => void;
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
          title={`Solving ${label} for ${Math.round(activeSolve.targetPoS * 100)}% PoS`}
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
      <label className="block text-[11px] text-ink-3" htmlFor={id}>
        {label}
      </label>
      <div className="relative mt-1 flex items-center gap-1.5">
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
          className="h-9 w-24 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          aria-label={label}
        />
        <SolverSolveIcon
          label={`Solve ${label}`}
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
    </div>
  );
}
