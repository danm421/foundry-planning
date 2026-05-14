"use client";

import { useState } from "react";
import type { ClientData, Income } from "@/engine";
import type { SolverMutation, SolverPerson } from "@/lib/solver/types";
import { useSolverSide } from "./solver-section";
import { SolverSsEditDialog } from "./solver-ss-edit-dialog";

interface Props {
  baseIncomes: ClientData["incomes"];
  workingIncomes: ClientData["incomes"];
  baseClient: ClientData["client"];
  workingClient: ClientData["client"];
  onChange(m: SolverMutation): void;
}

export function SolverRowSocialSecurity({
  baseIncomes,
  workingIncomes,
  baseClient,
  workingClient,
  onChange,
}: Props) {
  const side = useSolverSide();

  const baseClientSs = ssFor(baseIncomes, "client");
  const workingClientSs = ssFor(workingIncomes, "client");
  const baseSpouseSs = ssFor(baseIncomes, "spouse");
  const workingSpouseSs = ssFor(workingIncomes, "spouse");

  if (!baseClientSs && !baseSpouseSs) return null;

  return (
    <div className="space-y-2.5 col-span-2">
      <div className="text-[13px] font-medium text-ink">Social Security</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
        {baseClientSs ? (
          side === "base" ? (
            <ReadOnlySummary
              label={`${baseClient.firstName}'s SS`}
              row={baseClientSs}
              client={baseClient}
              person="client"
            />
          ) : (
            <EditableSummary
              label={`${workingClient.firstName}'s SS`}
              row={workingClientSs ?? baseClientSs}
              client={workingClient}
              person="client"
              onChange={onChange}
            />
          )
        ) : null}
        {baseSpouseSs ? (
          side === "base" ? (
            <ReadOnlySummary
              label={`${baseClient.spouseName ?? "Spouse"}'s SS`}
              row={baseSpouseSs}
              client={baseClient}
              person="spouse"
            />
          ) : (
            <EditableSummary
              label={`${workingClient.spouseName ?? "Spouse"}'s SS`}
              row={workingSpouseSs ?? baseSpouseSs}
              client={workingClient}
              person="spouse"
              onChange={onChange}
            />
          )
        ) : null}
      </div>
    </div>
  );
}

function ssFor(incomes: ClientData["incomes"], owner: SolverPerson): Income | undefined {
  return incomes.find((i) => i.type === "social_security" && i.owner === owner);
}

function ReadOnlySummary({
  label,
  row,
  client,
  person,
}: {
  label: string;
  row: Income;
  client: ClientData["client"];
  person: SolverPerson;
}) {
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-0.5 text-[14px] text-ink-2 leading-snug">
        {renderSummary(row, client, person)}
      </div>
    </div>
  );
}

function EditableSummary({
  label,
  row,
  client,
  person,
  onChange,
}: {
  label: string;
  row: Income;
  client: ClientData["client"];
  person: SolverPerson;
  onChange(m: SolverMutation): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="text-[11px] text-ink-3">{label}</div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-0.5 group flex w-full items-start justify-between gap-2 rounded-md border border-hair-2 bg-card-2 px-2.5 py-1.5 text-left text-[14px] text-ink hover:border-accent/60 hover:bg-card-hover focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 border-l-2 border-l-accent/70"
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
