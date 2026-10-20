"use client";

import { useState } from "react";
import type { ClientData, Income } from "@/engine";
import { resolveClaimAgeMonths } from "@/engine/socialSecurity/claimAge";
import {
  ageLabel,
  entryUnit,
  initialStatedAge,
  ownMonthlyAtClaim,
  ssEntryLabel,
  storedFigureForMonthlyAtClaim,
  toMonthly,
} from "@/lib/social-security/benefit-entry";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
  type SolverPerson,
} from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { FieldHintPopover, type HintRow } from "@/components/forms/field-hint-popover";
import { SolverBaseHint } from "./solver-base-hint";
import { CurrencyAmountInput } from "./solver-currency-amount-input";
import { SolverFieldActions } from "./solver-field-actions";
import { SolverSsEditDialog } from "./solver-ss-edit-dialog";
import { SolverSolveIcon } from "./solver-solve-icon";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

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
            incomes={workingIncomes}
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
            label={`${workingClient.spouseName ?? CO_CLIENT_LABEL}'s SS`}
            row={workingSpouseSs ?? baseSpouseSs}
            client={workingClient}
            incomes={workingIncomes}
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

/** The seven mutation keys a single person's SS edit can write — reset clears all
 *  so a partial reset can't leave half the change behind. */
function ssResetKeys(person: SolverPerson): SolverMutationKey[] {
  return [
    mutationKey({ kind: "ss-benefit-mode", person, mode: "manual_amount" }),
    mutationKey({ kind: "ss-pia-monthly", person, amount: 0 }),
    mutationKey({ kind: "ss-annual-amount", person, amount: 0 }),
    mutationKey({ kind: "ss-claim-age-mode", person, mode: "years" }),
    mutationKey({ kind: "ss-claim-age", person, age: 0 }),
    mutationKey({ kind: "ss-cola", person, rate: 0 }),
    mutationKey({ kind: "ss-stated-age", person, age: 0, months: 0 }),
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
    (base.ssStatedAge ?? null) !== (working.ssStatedAge ?? null) ||
    (base.ssStatedAgeMonths ?? null) !== (working.ssStatedAgeMonths ?? null) ||
    base.annualAmount !== working.annualAmount ||
    (base.growthRate ?? null) !== (working.growthRate ?? null)
  );
}

/** The whole ages the card's claim-age picker offers — SSA's 62-70 window. */
const WHOLE_CLAIM_AGES_MONTHS = [62, 63, 64, 65, 66, 67, 68, 69, 70].map((y) => y * 12);

/** The picker's ages, plus the current one when it is not a whole 62-70 age
 *  (FRA's 66y 10mo, a retirement age of 60) so the picker can show it. */
function claimAgeOptions(currentMonths: number): number[] {
  return [...new Set([...WHOLE_CLAIM_AGES_MONTHS, currentMonths])].sort((a, b) => a - b);
}

/** Picking a whole claim age on the card. */
function claimAgeMutations(
  row: Income,
  client: ClientData["client"],
  person: SolverPerson,
  age: number,
): SolverMutation[] {
  const out: SolverMutation[] = [];
  // A stated benefit with no stated age is quoted AT the claim age, so moving
  // the claim age would carry the same dollars along. Pin it where it is
  // quoted now so the new age re-prices it.
  if ((row.ssBenefitMode ?? "manual_amount") === "manual_amount" && !Number.isFinite(row.ssStatedAge)) {
    const at = initialStatedAge(row, client);
    out.push({ kind: "ss-stated-age", person, age: at.years, months: at.months });
  }
  if ((row.claimingAgeMode ?? "years") !== "years") {
    out.push({ kind: "ss-claim-age-mode", person, mode: "years" });
  }
  out.push({ kind: "ss-claim-age", person, age, months: 0 });
  return out;
}

/** Typing the benefit at the claim age: stored as the PIA it implies, or as
 *  the stated benefit at the row's own stated age. */
function amountMutation(
  row: Income,
  client: ClientData["client"],
  person: SolverPerson,
  monthly: number,
): SolverMutation | null {
  const figure = storedFigureForMonthlyAtClaim(row, client, monthly);
  if (figure == null) return null;
  return row.ssBenefitMode === "pia_at_fra"
    ? { kind: "ss-pia-monthly", person, amount: figure }
    : { kind: "ss-annual-amount", person, amount: figure };
}

const unitSuffix = (row: Income) => (entryUnit(row) === "annual" ? "/yr" : "/mo");

/** The benefit at the claim age, in the row's entry unit (/mo or /yr). */
function claimBenefitInUnit(row: Income, client: ClientData["client"]): number | null {
  const monthly = ownMonthlyAtClaim(row, client);
  if (monthly == null) return null;
  return entryUnit(row) === "annual" ? monthly * 12 : monthly;
}

/** "$2,520/mo at 62" — what the row pays at its claim age. Null when the row
 *  can't be priced (No benefit, nothing entered, no DOB). */
function claimBenefitLabel(row: Income, client: ClientData["client"]): string | null {
  const amount = claimBenefitInUnit(row, client);
  const claim = resolveClaimAgeMonths(row, client);
  if (amount == null || claim == null) return null;
  return `$${Math.round(amount).toLocaleString("en-US")}${unitSuffix(row)} at ${ageLabel(Math.floor(claim / 12), claim % 12)}`;
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 text-ink-3 group-hover:text-ink-2"
      fill="currentColor"
    >
      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474L4.42 15.14a.75.75 0 0 1-.36.198l-3.25.75a.75.75 0 0 1-.902-.901l.75-3.25a.75.75 0 0 1 .198-.36L11.013 1.427Z" />
    </svg>
  );
}

function EditableSummary({
  label,
  row,
  client,
  incomes,
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
  incomes: ClientData["incomes"];
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
  const amountLabel = ssAmountLabel(row, client);
  const benefitAtClaim = claimBenefitInUnit(row, client);
  const detailRows = ssDetailRows(row, client, person);

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

  const inline = benefitAtClaim != null && claimAgeMonths != null;

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-3">{label}</span>
        {detailRows.length ? <FieldHintPopover label={`${label} details`} rows={detailRows} /> : null}
        {inline ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group grid h-5 w-5 place-items-center rounded hover:bg-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            aria-label={`Edit ${label}`}
            title="More Social Security settings"
          >
            <PencilIcon />
          </button>
        ) : null}
      </div>
      {inline ? (
        // "$2,520/mo at 62" — both halves edit in place; the amount re-prices
        // as the age moves. The pencil above opens the full editor (benefit
        // mode, months, FRA / at-retirement, COLA).
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <CurrencyAmountInput
            id={`solver-ss-amount-${person}`}
            label={`${label} benefit at claim age`}
            value={benefitAtClaim}
            widthClassName="w-[5.75rem]"
            onCommit={(n) => {
              const m = amountMutation(row, client, person, toMonthly(n, entryUnit(row)));
              if (m) onChange(m);
            }}
          />
          <span className="text-[13px] text-ink-3">{unitSuffix(row)} at</span>
          <span className="relative">
            <select
              aria-label={`${label} claim age`}
              value={claimAgeMonths}
              onChange={(e) =>
                claimAgeMutations(row, client, person, Math.floor(Number(e.target.value) / 12)).forEach(onChange)
              }
              className="h-9 appearance-none rounded-md border border-hair-2 border-l-2 border-l-accent/70 bg-card-2 pl-2.5 pr-7 text-[14px] text-ink tabular focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              {claimAgeOptions(claimAgeMonths).map((m) => (
                <option key={m} value={m}>
                  {ageLabel(Math.floor(m / 12), m % 12)}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.04l3.71-3.81a.75.75 0 111.08 1.04l-4.25 4.36a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group mt-0.5 flex w-full items-start justify-between gap-2 rounded-md border border-hair-2 bg-card-2 px-2.5 py-1.5 text-left text-[14px] text-ink hover:border-accent/60 hover:bg-card-hover focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 border-l-2 border-l-accent/70"
          aria-label={`Edit ${label}`}
        >
          <span className="flex-1 leading-snug tabular text-ink-2">{amountLabel}</span>
          <span className="mt-0.5">
            <PencilIcon />
          </span>
        </button>
      )}
      <SolverFieldActions>
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
        <SolverBaseHint
          base={baseRow}
          working={row}
          changed={ssChanged(baseRow, row)}
          format={() => renderSummary(baseRow, baseClient, person)}
          onReset={
            onResetField ? () => onResetField(ssResetKeys(person)) : undefined
          }
        />
      </SolverFieldActions>
      {open ? (
        <SolverSsEditDialog
          open={open}
          onClose={() => setOpen(false)}
          onEmit={(mutations) => mutations.forEach(onChange)}
          person={person}
          client={client}
          workingRow={row}
          incomes={incomes}
        />
      ) : null}
    </div>
  );
}

function claimLabelFor(
  row: Income,
  client: ClientData["client"],
  person: SolverPerson,
): string {
  const claimMode = row.claimingAgeMode ?? "years";
  if (claimMode === "fra") return "FRA";
  if (claimMode === "at_retirement") {
    const ret = person === "spouse" ? client.spouseRetirementAge : client.retirementAge;
    return `Retirement${ret != null ? ` (${ret})` : ""}`;
  }
  const years = row.claimingAge ?? 67;
  const months = row.claimingAgeMonths ?? 0;
  return months > 0 ? `${years}y ${months}mo` : `${years}`;
}

function colaPct(row: Income): string | null {
  if (row.growthRate == null) return null;
  return `${(row.growthRate * 100).toFixed((row.growthRate * 100) % 1 === 0 ? 0 : 1)}%`;
}

export function ssAmountLabel(row: Income, client: ClientData["client"]): string {
  const benefitMode = row.ssBenefitMode ?? "manual_amount";
  return (
    ssEntryLabel(row, client) ??
    (benefitMode === "no_benefit" ? "No benefit" : benefitMode === "pia_at_fra" ? "PIA" : "Benefit at an age")
  );
}

export function ssDetailRows(
  row: Income,
  client: ClientData["client"],
  person: SolverPerson,
): HintRow[] {
  if ((row.ssBenefitMode ?? "manual_amount") === "no_benefit") return [];
  const rows: HintRow[] = [];
  // The card shows the benefit at the claim age; this keeps the figure as entered.
  const entered = ssEntryLabel(row, client);
  if (entered) rows.push({ term: "Entered", value: entered });
  rows.push({ term: "Claim at", value: claimLabelFor(row, client, person) });
  const cola = colaPct(row);
  if (cola) rows.push({ term: "COLA", value: cola });
  return rows;
}

function renderSummary(
  row: Income,
  client: ClientData["client"],
  person: SolverPerson,
): React.ReactNode {
  if ((row.ssBenefitMode ?? "manual_amount") === "no_benefit") {
    return <span className="text-ink-3">No benefit</span>;
  }
  const cola = colaPct(row);
  const atClaim = claimBenefitLabel(row, client);
  return (
    <span className="tabular">
      {atClaim ? (
        <span>{atClaim}</span>
      ) : (
        <>
          <span>{ssAmountLabel(row, client)}</span>
          <span className="text-ink-3"> · </span>
          <span>Claim at {claimLabelFor(row, client, person)}</span>
        </>
      )}
      {cola ? (
        <>
          <span className="text-ink-3"> · </span>
          <span>{cola} COLA</span>
        </>
      ) : null}
    </span>
  );
}
