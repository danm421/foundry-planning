"use client";

import { useState } from "react";
import type { ClientData, Income } from "@/engine";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
  type SolverPerson,
} from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { SolverBaseHint } from "./solver-base-hint";
import { SolverSsEditDialog } from "./solver-ss-edit-dialog";
import { SolverSolveIcon } from "./solver-solve-icon";

type ActiveSolve = {
  target: SolveLeverKey;
  targetPoS?: number;
  iteration: number;
  candidateValue: number | null;
  achievedPoS: number | null;
};

const SS_CLAIM_AGE_SOLVE_DESCRIPTION =
  "Finds the Social Security claiming age that leaves the most money in the portfolio at the end of the plan (deterministic projection — no Monte Carlo).";

interface Props {
  baseIncomes: ClientData["incomes"];
  workingIncomes: ClientData["incomes"];
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS?: number) => void;
  onSolveCancel: () => void;
}

export function SolverRowSocialSecurity({
  baseIncomes,
  workingIncomes,
  baseClient,
  workingClient,
  onChange,
  onResetField,
  activeSolve,
  onSolveStart,
  onSolveCancel,
}: Props) {
  const baseClientSs = ssFor(baseIncomes, "client");
  const workingClientSs = ssFor(workingIncomes, "client");
  const baseSpouseSs = ssFor(baseIncomes, "spouse");
  const workingSpouseSs = ssFor(workingIncomes, "spouse");

  if (!baseClientSs && !baseSpouseSs) return null;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Social Security</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
        {baseClientSs ? (
          <EditableSummary
            label={`${workingClient.firstName}'s SS`}
            row={workingClientSs ?? baseClientSs}
            client={workingClient}
            baseRow={baseClientSs}
            baseClient={baseClient}
            person="client"
            activeSolve={activeSolve}
            onSolveStart={onSolveStart}
            onSolveCancel={onSolveCancel}
            onChange={onChange}
            onResetField={onResetField}
          />
        ) : null}
        {baseSpouseSs ? (
          <EditableSummary
            label={`${workingClient.spouseName ?? "Spouse"}'s SS`}
            row={workingSpouseSs ?? baseSpouseSs}
            client={workingClient}
            baseRow={baseSpouseSs}
            baseClient={baseClient}
            person="spouse"
            activeSolve={activeSolve}
            onSolveStart={onSolveStart}
            onSolveCancel={onSolveCancel}
            onChange={onChange}
            onResetField={onResetField}
          />
        ) : null}
      </div>
    </div>
  );
}

function ssFor(incomes: ClientData["incomes"], owner: SolverPerson): Income | undefined {
  return incomes.find((i) => i.type === "social_security" && i.owner === owner);
}

/** The six mutation keys a single person's SS edit can write — reset clears all
 *  so a partial reset can't leave half the change behind. */
function ssResetKeys(person: SolverPerson): SolverMutationKey[] {
  return [
    mutationKey({ kind: "ss-benefit-mode", person, mode: "manual_amount" }),
    mutationKey({ kind: "ss-pia-monthly", person, amount: 0 }),
    mutationKey({ kind: "ss-annual-amount", person, amount: 0 }),
    mutationKey({ kind: "ss-claim-age-mode", person, mode: "years" }),
    mutationKey({ kind: "ss-claim-age", person, age: 0 }),
    mutationKey({ kind: "ss-cola", person, rate: 0 }),
  ];
}

/** True when any SS field surfaced by renderSummary differs base↔working. The
 *  rows are distinct Income object refs, so Object.is would always say changed —
 *  compare the meaningful fields instead. */
function ssChanged(base: Income, working: Income): boolean {
  return (
    (base.ssBenefitMode ?? "manual_amount") !== (working.ssBenefitMode ?? "manual_amount") ||
    (base.claimingAgeMode ?? "years") !== (working.claimingAgeMode ?? "years") ||
    (base.claimingAge ?? 67) !== (working.claimingAge ?? 67) ||
    (base.claimingAgeMonths ?? 0) !== (working.claimingAgeMonths ?? 0) ||
    (base.piaMonthly ?? null) !== (working.piaMonthly ?? null) ||
    base.annualAmount !== working.annualAmount ||
    (base.growthRate ?? null) !== (working.growthRate ?? null)
  );
}

function EditableSummary({
  label,
  row,
  client,
  baseRow,
  baseClient,
  person,
  activeSolve,
  onSolveStart,
  onSolveCancel,
  onChange,
  onResetField,
}: {
  label: string;
  row: Income;
  client: ClientData["client"];
  baseRow: Income;
  baseClient: ClientData["client"];
  person: SolverPerson;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS?: number) => void;
  onSolveCancel: () => void;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const target: SolveLeverKey = { kind: "ss-claim-age", person };
  const isSolvingHere =
    activeSolve?.target.kind === "ss-claim-age" &&
    (activeSolve.target as { kind: "ss-claim-age"; person: SolverPerson }).person === person;
  const otherSolveActive = activeSolve !== null && !isSolvingHere;

  // Once a person is already collecting, their claim age is locked in the past
  // and can't be solved — mirror the engine's "has claimed this year" test.
  const claimAgeMonths = resolveClaimAgeMonths(row, client);
  const dob = person === "spouse" ? client.spouseDob : client.dateOfBirth;
  const birthYear = dob ? Number(String(dob).slice(0, 4)) : NaN;
  const ageMonthsThisYear = Number.isFinite(birthYear)
    ? (new Date().getFullYear() - birthYear) * 12
    : null;
  const alreadyClaiming =
    claimAgeMonths != null &&
    ageMonthsThisYear != null &&
    ageMonthsThisYear >= claimAgeMonths;

  if (isSolvingHere) {
    return (
      <div>
        <div className="text-[11px] text-ink-3">{label}</div>
        <div
          role="status"
          aria-live="polite"
          className="mt-0.5 flex items-center gap-2 rounded-md border border-hair-2 bg-card-2 px-2.5 py-1.5 text-[13px] text-ink-2"
        >
          <span
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
            aria-hidden="true"
          />
          <span>Solving claim age…</span>
          <button
            type="button"
            onClick={onSolveCancel}
            className="ml-auto text-[12px] text-ink-3 underline hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex flex-1 items-start justify-between gap-2 rounded-md border border-hair-2 bg-card-2 px-2.5 py-1.5 text-left text-[14px] text-ink hover:border-accent/60 hover:bg-card-hover focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 border-l-2 border-l-accent/70"
          aria-label={`Edit ${label}`}
        >
          <span className="flex-1 leading-snug text-ink-2">
            {renderSummary(row, client, person)}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3 group-hover:text-ink-2"
            fill="currentColor"
          >
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474L4.42 15.14a.75.75 0 0 1-.36.198l-3.25.75a.75.75 0 0 1-.902-.901l.75-3.25a.75.75 0 0 1 .198-.36L11.013 1.427Z" />
          </svg>
        </button>
        <div className="shrink-0">
          <SolverSolveIcon
            label={`Solve ${label} Claim Age`}
            tooltip={SS_CLAIM_AGE_SOLVE_DESCRIPTION}
            disabled={otherSolveActive || alreadyClaiming}
            disabledReason={
              alreadyClaiming
                ? "Already collecting Social Security — claim age can't be solved."
                : undefined
            }
            onClick={() => onSolveStart(target)}
          />
        </div>
      </div>
      <SolverBaseHint
        base={baseRow}
        working={row}
        changed={ssChanged(baseRow, row)}
        format={() => renderSummary(baseRow, baseClient, person)}
        onReset={
          onResetField ? () => onResetField(ssResetKeys(person)) : undefined
        }
      />
      {open ? (
        <SolverSsEditDialog
          open={open}
          onClose={() => setOpen(false)}
          onEmit={(mutations) => mutations.forEach(onChange)}
          person={person}
          client={client}
          workingRow={row}
        />
      ) : null}
    </div>
  );
}

function renderSummary(
  row: Income,
  client: ClientData["client"],
  person: SolverPerson,
): React.ReactNode {
  const benefitMode = row.ssBenefitMode ?? "manual_amount";
  if (benefitMode === "no_benefit") {
    return <span className="text-ink-3">No benefit</span>;
  }

  const claimMode = row.claimingAgeMode ?? "years";
  let claimLabel: string;
  if (claimMode === "fra") {
    claimLabel = "FRA";
  } else if (claimMode === "at_retirement") {
    const ret =
      person === "spouse" ? client.spouseRetirementAge : client.retirementAge;
    claimLabel = `Retirement${ret != null ? ` (${ret})` : ""}`;
  } else {
    const years = row.claimingAge ?? 67;
    const months = row.claimingAgeMonths ?? 0;
    claimLabel = months > 0 ? `${years}y ${months}mo` : `${years}`;
  }

  const cola = row.growthRate != null
    ? `${(row.growthRate * 100).toFixed(row.growthRate * 100 % 1 === 0 ? 0 : 1)}% COLA`
    : null;

  let amountLabel: string;
  if (benefitMode === "pia_at_fra") {
    amountLabel = row.piaMonthly != null
      ? `$${Math.round(row.piaMonthly).toLocaleString()}/mo PIA`
      : "PIA";
  } else {
    amountLabel = row.annualAmount > 0
      ? `$${Math.round(row.annualAmount).toLocaleString()}/yr`
      : "Manual amount";
  }

  return (
    <span className="tabular">
      <span>{amountLabel}</span>
      <span className="text-ink-3"> · </span>
      <span>Claim at {claimLabel}</span>
      {cola ? (
        <>
          <span className="text-ink-3"> · </span>
          <span>{cola}</span>
        </>
      ) : null}
    </span>
  );
}
