"use client";

import type { ClientData } from "@/engine";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
  type SolverPerson,
} from "@/lib/solver/types";
import { SolverBaseHint } from "./solver-base-hint";
import { SolverFieldSlider } from "./solver-field-slider";
import { SolverYearEdit } from "./solver-year-edit";
import { birthYearFromDob, yearForAge } from "@/lib/age-year";

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
  const clientBirthYear = birthYearFromDob(workingClient.dateOfBirth);
  const spouseBirthYear = birthYearFromDob(workingClient.spouseDob);

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Life Expectancy</div>
      <div className="space-y-4">
        <Editable
          id="le-client"
          label={`${workingClient.firstName}'s Life Expectancy`}
          value={workingClient.lifeExpectancy ?? 95}
          base={baseClient.lifeExpectancy ?? 95}
          min={clientMinLE}
          max={110}
          person="client"
          birthYear={clientBirthYear}
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
            birthYear={spouseBirthYear}
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
  birthYear,
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
  birthYear: number | null;
  onCommit: (v: number) => void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="text-[11px] text-ink-3" htmlFor={id}>
          {label}
        </label>
        <SolverYearEdit
          year={yearForAge(birthYear, value)}
          birthYear={birthYear}
          min={min}
          max={max}
          ariaLabel={`${label} calendar year`}
          onCommitAge={onCommit}
        />
      </div>
      <SolverFieldSlider
        id={id}
        label={label}
        value={value}
        min={min}
        max={max}
        onCommit={onCommit}
      />
      <SolverBaseHint
        base={base}
        working={value}
        onReset={
          onResetField
            ? () =>
                onResetField([
                  mutationKey({ kind: "life-expectancy", person, age: 0 }),
                ])
            : undefined
        }
      />
    </div>
  );
}
