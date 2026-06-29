"use client";

import { useRef, useState } from "react";
import type { Account, ClientData, SavingsRule } from "@/engine";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
} from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { activeSavingsRules } from "@/lib/solver/active-savings-rules";
import { supportsRothSplit } from "@/components/forms/contribution-amount-fields";
import { FieldHintPopover, type HintRow } from "@/components/forms/field-hint-popover";
import { SolverBaseHint } from "./solver-base-hint";
import { RothSplitControl } from "./solver-roth-split-control";
import { SolverSavingsEditDialog } from "./solver-savings-edit-dialog";
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

const SAVINGS_CONTRIBUTION_SOLVE_DESCRIPTION =
  "Finds the annual contribution to this account that reaches your target probability of success.";

interface Props {
  baseClientData: ClientData;
  workingClientData: ClientData;
  currentYear: number;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
  onSolveCancel: () => void;
  /** fundFromExpenseReduction accounts the advisor chose to surface as boxes. */
  visibleSelfFundingAccts?: Set<string>;
}

/** Every per-account savings mutation key the inline inputs + edit dialog can
 *  write. A reset clears the whole group so a partial edit doesn't half-revert. */
function savingsResetKeys(accountId: string): SolverMutationKey[] {
  return [
    mutationKey({ kind: "savings-contribution", accountId, annualAmount: 0 }),
    mutationKey({ kind: "savings-annual-percent", accountId, percent: null }),
    mutationKey({ kind: "savings-roth-percent", accountId, rothPercent: 0 }),
    mutationKey({ kind: "savings-contribute-max", accountId, value: false }),
    mutationKey({ kind: "savings-growth-rate", accountId, rate: 0 }),
    mutationKey({ kind: "savings-growth-source", accountId, source: "custom" }),
    mutationKey({ kind: "savings-deductible", accountId, value: true }),
    mutationKey({ kind: "savings-apply-cap", accountId, value: true }),
    mutationKey({ kind: "savings-employer-match-pct", accountId, pct: 0, cap: null }),
    mutationKey({ kind: "savings-employer-match-amount", accountId, amount: 0 }),
    mutationKey({ kind: "savings-start-year", accountId, year: 0 }),
    mutationKey({ kind: "savings-end-year", accountId, year: 0 }),
  ];
}

export function SolverRowSavingsContributions({
  baseClientData,
  workingClientData,
  currentYear,
  onChange,
  onResetField,
  activeSolve,
  onSolveStart,
  onSolveCancel,
  visibleSelfFundingAccts,
}: Props) {
  const baseActive = activeSavingsRules(baseClientData.savingsRules, currentYear);
  const visible = visibleSelfFundingAccts ?? new Set<string>();

  const baseRuleIds = new Set(baseClientData.savingsRules.map((r) => r.id));
  const workingAdded = activeSavingsRules(workingClientData.savingsRules, currentYear)
    .filter((r) => !baseRuleIds.has(r.id) && (!r.fundFromExpenseReduction || visible.has(r.accountId)));

  if (baseActive.length === 0 && workingAdded.length === 0) return null;

  const resolvedInflationRate =
    workingClientData.planSettings?.inflationRate ??
    baseClientData.planSettings?.inflationRate ??
    0.03;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Savings Contributions</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        {baseActive.map((baseRule) => {
          const account = baseClientData.accounts.find((a) => a.id === baseRule.accountId);
          const label = account?.name ?? baseRule.accountId.slice(0, 6);
          const workingRule =
            workingClientData.savingsRules.find((r) => r.id === baseRule.id) ?? baseRule;
          const workingAccount =
            workingClientData.accounts.find((a) => a.id === baseRule.accountId) ?? account;
          return (
            <Editable
              key={baseRule.id}
              label={label}
              baseRule={baseRule}
              workingRule={workingRule}
              workingAccount={workingAccount}
              resolvedInflationRate={resolvedInflationRate}
              activeSolve={activeSolve}
              onSolveStart={onSolveStart}
              onSolveCancel={onSolveCancel}
              onChange={onChange}
              onResetField={onResetField}
            />
          );
        })}
        {workingAdded.map((rule) => {
          const account = workingClientData.accounts.find((a) => a.id === rule.accountId);
          const label = account?.name ?? rule.accountId.slice(0, 6);
          return (
            <Editable
              key={rule.id}
              label={label}
              baseRule={null}
              workingRule={rule}
              workingAccount={account}
              resolvedInflationRate={resolvedInflationRate}
              activeSolve={activeSolve}
              onSolveStart={onSolveStart}
              onSolveCancel={onSolveCancel}
              onChange={onChange}
              onResetField={onResetField}
            />
          );
        })}
      </div>
    </div>
  );
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatPct(decimal: number): string {
  const pct = Math.round(decimal * 10000) / 100;
  return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(2)}%`;
}

function contributionLabel(rule: SavingsRule): string {
  if (rule.contributeMax) return "IRS max";
  if (rule.annualPercent != null && rule.annualPercent > 0) {
    return `${formatPct(rule.annualPercent)} of salary`;
  }
  return `${formatCurrency(rule.annualAmount)}/yr`;
}

function employerMatchLabel(rule: SavingsRule): string | null {
  if (rule.employerMatchAmount != null && rule.employerMatchAmount > 0) {
    return `+ ${formatCurrency(rule.employerMatchAmount)} match`;
  }
  if (rule.employerMatchPct != null && rule.employerMatchPct > 0) {
    if (rule.employerMatchCap != null && rule.employerMatchCap > 0) {
      return `+ ${formatPct(rule.employerMatchPct)} match (cap ${formatPct(rule.employerMatchCap)})`;
    }
    return `+ ${formatPct(rule.employerMatchPct)} match`;
  }
  return null;
}

function windowLabel(rule: SavingsRule, currentYear: number): string | null {
  if (rule.endYear == null) return null;
  if (rule.startYear > currentYear) return `${rule.startYear}–${rule.endYear}`;
  return `thru ${rule.endYear}`;
}

function rothTag(rule: SavingsRule): string | null {
  const roth = rule.rothPercent ?? 0;
  if (roth <= 0) return null;
  if (roth >= 1) return "Roth";
  return "Roth + Pre-tax";
}

export function savingsDetailRows(rule: SavingsRule, currentYear: number): HintRow[] {
  const rows: HintRow[] = [];
  const match = employerMatchLabel(rule);
  if (match) rows.push({ value: match });
  if (rule.growthSource === "inflation") {
    rows.push({ term: "Growth", value: "infl-linked" });
  } else if (rule.growthRate != null && rule.growthRate > 0) {
    rows.push({ term: "Growth", value: formatPct(rule.growthRate) });
  }
  const window = windowLabel(rule, currentYear);
  if (window) rows.push({ term: "Window", value: window });
  const roth = rothTag(rule);
  if (roth) rows.push({ value: roth });
  if (!rule.isDeductible) rows.push({ value: "after-tax" });
  if (rule.applyContributionLimit === false) rows.push({ value: "uncapped" });
  return rows;
}

/** Contribution amount used for the base-vs-working hint comparison. Reads the
 *  dollar amount, falling back to percent when the rule contributes by percent. */
function contributionMagnitude(rule: SavingsRule): number {
  if (rule.contributeMax) return Number.POSITIVE_INFINITY;
  if (rule.annualPercent != null && rule.annualPercent > 0) return rule.annualPercent;
  return rule.annualAmount;
}

function Editable({
  label,
  baseRule,
  workingRule,
  workingAccount,
  resolvedInflationRate,
  activeSolve,
  onSolveStart,
  onSolveCancel,
  onChange,
  onResetField,
}: {
  label: string;
  /** The base counterpart, or null for a rule added in the scenario. */
  baseRule: SavingsRule | null;
  workingRule: SavingsRule;
  workingAccount: Account | undefined;
  resolvedInflationRate: number;
  activeSolve: ActiveSolve | null;
  onSolveStart: (target: SolveLeverKey, targetPoS: number) => void;
  onSolveCancel: () => void;
  onChange(m: SolverMutation): void;
  onResetField?: (keys: SolverMutationKey[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  // Bumps on reset to remount the contribution inputs so their local state
  // re-seeds from the reverted base value (they seed from defaultValue once).
  const [resetTick, setResetTick] = useState(0);
  const detailRows = savingsDetailRows(workingRule, new Date().getFullYear());
  const inputId = `s-${workingRule.id}`;
  const isMaxMode = !!workingRule.contributeMax;
  const isPercentMode =
    !isMaxMode &&
    workingRule.annualPercent != null &&
    workingRule.annualPercent > 0;
  const isDollarMode = !isMaxMode && !isPercentMode;

  const target: SolveLeverKey = { kind: "savings-contribution", accountId: workingRule.accountId };
  const isSolvingHere =
    activeSolve?.target.kind === "savings-contribution" &&
    (activeSolve.target as { kind: "savings-contribution"; accountId: string }).accountId ===
      workingRule.accountId;
  const otherSolveActive = activeSolve !== null && !isSolvingHere;

  if (isDollarMode && isSolvingHere) {
    return (
      <div>
        <div className="text-[11px] text-ink-3 truncate mb-1">{label}</div>
        <SolverSolveProgressStrip
          title={`Solving ${label} for ${Math.round(activeSolve.targetPoS! * 100)}% PoS`}
          iteration={activeSolve.iteration}
          maxIterations={8}
          candidateValue={activeSolve.candidateValue}
          achievedPoS={activeSolve.achievedPoS}
          valueFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
          onCancel={onSolveCancel}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex min-w-0 items-center gap-1.5">
        <label className="min-w-0 truncate text-[11px] text-ink-3" htmlFor={inputId}>
          {label}
        </label>
        {detailRows.length ? <FieldHintPopover label={`${label} details`} rows={detailRows} /> : null}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        {isDollarMode ? (
          <CurrencyAmountInput
            key={`${workingRule.id}-${resetTick}`}
            id={inputId}
            label={label}
            defaultValue={workingRule.annualAmount}
            onCommit={(n) =>
              onChange({
                kind: "savings-contribution",
                accountId: workingRule.accountId,
                annualAmount: n,
              })
            }
          />
        ) : isPercentMode ? (
          <>
            <PercentAmountInput
              key={`${workingRule.id}-${resetTick}`}
              id={inputId}
              label={`${label} (% of salary)`}
              defaultValue={workingRule.annualPercent ?? 0}
              onCommit={(decimal) =>
                onChange({
                  kind: "savings-annual-percent",
                  accountId: workingRule.accountId,
                  percent: decimal,
                })
              }
            />
            <span className="whitespace-nowrap text-[12px] text-ink-3">of salary</span>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            id={inputId}
            className="h-9 rounded-md border border-hair-2 bg-card-2 px-3 text-left text-[14px] text-ink tabular border-l-2 border-l-accent/70 whitespace-nowrap hover:bg-card-hover focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            aria-label={`Edit ${label}`}
          >
            IRS max
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hair-2 bg-card-2 text-ink-3 hover:bg-card-hover hover:text-ink-2 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          aria-label={`Advanced edit ${label}`}
          title="Advanced edit"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474L4.42 15.14a.75.75 0 0 1-.36.198l-3.25.75a.75.75 0 0 1-.902-.901l.75-3.25a.75.75 0 0 1 .198-.36L11.013 1.427Z" />
          </svg>
        </button>
        {isDollarMode ? (
          <div ref={anchorRef} className="relative">
            <SolverSolveIcon
              label={`Solve ${label}`}
              tooltip={SAVINGS_CONTRIBUTION_SOLVE_DESCRIPTION}
              disabled={otherSolveActive}
              onClick={() => setPopoverOpen(true)}
            />
            {popoverOpen ? (
              <SolverSolvePopover
                title={`Solve ${label}`}
                rangeLabel="$0–$100k"
                defaultTargetPct={85}
                open={popoverOpen}
                anchorRef={anchorRef}
                onClose={() => setPopoverOpen(false)}
                onSubmit={(targetPoS) => {
                  setPopoverOpen(false);
                  onSolveStart(target, targetPoS);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {baseRule ? (
        <SolverBaseHint
          base={baseRule}
          working={workingRule}
          changed={contributionMagnitude(baseRule) !== contributionMagnitude(workingRule)}
          format={(r) => contributionLabel(r)}
          onReset={
            onResetField
              ? () => {
                  onResetField(savingsResetKeys(workingRule.accountId));
                  setResetTick((t) => t + 1);
                }
              : undefined
          }
        />
      ) : (
        <div className="mt-0.5 text-[11px] text-accent">added in scenario</div>
      )}
      {workingAccount && supportsRothSplit(workingAccount.category, workingAccount.subType) ? (
        <RothSplitControl
          rothPercent={workingRule.rothPercent ?? null}
          onChange={(rothPercent) =>
            onChange({
              kind: "savings-roth-percent",
              accountId: workingRule.accountId,
              rothPercent,
            })
          }
        />
      ) : null}
      {open && workingAccount ? (
        <SolverSavingsEditDialog
          open={open}
          onClose={() => setOpen(false)}
          onEmit={(mutations) => mutations.forEach(onChange)}
          account={workingAccount}
          workingRule={workingRule}
          resolvedInflationRate={resolvedInflationRate}
        />
      ) : null}
    </div>
  );
}

/** Compact $-prefixed currency input sized for the row (matches the SS pencil button height). */
function CurrencyAmountInput({
  id,
  label,
  defaultValue,
  onCommit,
}: {
  id: string;
  label: string;
  defaultValue: number;
  onCommit: (n: number) => void;
}) {
  const [display, setDisplay] = useState<string>(
    Math.round(defaultValue).toLocaleString(),
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const n = raw === "" ? 0 : parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return;
    setDisplay(n.toLocaleString());
    onCommit(n);
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        className="h-9 w-32 rounded-md border border-hair-2 bg-card-2 pl-6 pr-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        aria-label={label}
      />
    </div>
  );
}

/** Compact percent input with a trailing "%", for "% of salary" contributions.
 *  Stores/emits the value as a decimal (0.10 = 10%). */
function PercentAmountInput({
  id,
  label,
  defaultValue,
  onCommit,
}: {
  id: string;
  label: string;
  defaultValue: number;
  onCommit: (decimal: number) => void;
}) {
  const [display, setDisplay] = useState<string>(formatPercentInput(defaultValue));

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setDisplay(raw);
    if (raw === "" || raw === ".") {
      onCommit(0);
      return;
    }
    const n = parseFloat(raw);
    if (Number.isNaN(n) || n < 0) return;
    onCommit(n / 100);
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        className="h-9 w-20 rounded-md border border-hair-2 bg-card-2 pl-2.5 pr-6 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        aria-label={label}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
        %
      </span>
    </div>
  );
}

/** Render a stored decimal percent (0.10) as an editable number string ("10"). */
function formatPercentInput(decimal: number): string {
  const pct = Math.round(decimal * 10000) / 100;
  return pct % 1 === 0 ? String(pct) : pct.toFixed(2);
}
