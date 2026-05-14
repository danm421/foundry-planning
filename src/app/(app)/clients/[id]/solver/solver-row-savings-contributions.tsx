"use client";

import { useState } from "react";
import type { Account, ClientData, SavingsRule } from "@/engine";
import type { SolverMutation } from "@/lib/solver/types";
import { activeSavingsRules } from "@/lib/solver/active-savings-rules";
import { useSolverSide } from "./solver-section";
import { SolverSavingsEditDialog } from "./solver-savings-edit-dialog";

interface Props {
  baseClientData: ClientData;
  workingClientData: ClientData;
  currentYear: number;
  onChange(m: SolverMutation): void;
}

export function SolverRowSavingsContributions({
  baseClientData,
  workingClientData,
  currentYear,
  onChange,
}: Props) {
  const side = useSolverSide();
  const baseActive = activeSavingsRules(baseClientData.savingsRules, currentYear);
  if (baseActive.length === 0) return null;

  const resolvedInflationRate =
    workingClientData.planSettings?.inflationRate ??
    baseClientData.planSettings?.inflationRate ??
    0.03;

  return (
    <div className="space-y-2.5 col-span-2">
      <div className="text-[13px] font-medium text-ink">Savings Contributions</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        {baseActive.map((baseRule) => {
          const account = baseClientData.accounts.find((a) => a.id === baseRule.accountId);
          const label = account?.name ?? baseRule.accountId.slice(0, 6);
          if (side === "base") {
            return <ReadOnly key={baseRule.id} label={label} rule={baseRule} />;
          }
          const workingRule =
            workingClientData.savingsRules.find((r) => r.id === baseRule.id) ?? baseRule;
          const workingAccount =
            workingClientData.accounts.find((a) => a.id === baseRule.accountId) ?? account;
          return (
            <Editable
              key={baseRule.id}
              label={label}
              workingRule={workingRule}
              workingAccount={workingAccount}
              resolvedInflationRate={resolvedInflationRate}
              onChange={onChange}
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

function growthLabel(rule: SavingsRule): string | null {
  if (rule.growthSource === "inflation") return "infl-linked growth";
  if (rule.growthRate != null && rule.growthRate > 0) {
    return `${formatPct(rule.growthRate)} growth`;
  }
  return null;
}

function windowLabel(rule: SavingsRule, currentYear: number): string | null {
  if (rule.endYear == null) return null;
  if (rule.startYear > currentYear) return `${rule.startYear}–${rule.endYear}`;
  return `thru ${rule.endYear}`;
}

function ruleDetailParts(rule: SavingsRule, currentYear: number): string[] {
  return [
    employerMatchLabel(rule),
    growthLabel(rule),
    windowLabel(rule, currentYear),
    !rule.isDeductible ? "after-tax" : null,
    rule.applyContributionLimit === false ? "uncapped" : null,
  ].filter((s): s is string => s != null);
}

function DetailLine({ rule, currentYear }: { rule: SavingsRule; currentYear: number }) {
  const parts = ruleDetailParts(rule, currentYear);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1 text-[11px] text-ink-3 leading-snug">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? <span className="text-ink-4"> · </span> : null}
          <span>{p}</span>
        </span>
      ))}
    </div>
  );
}

function ReadOnly({ label, rule }: { label: string; rule: SavingsRule }) {
  return (
    <div>
      <div className="text-[11px] text-ink-3 truncate">{label}</div>
      <div className="mt-0.5 text-[15px] text-ink-2 tabular">
        {contributionLabel(rule)}
      </div>
      <DetailLine rule={rule} currentYear={new Date().getFullYear()} />
    </div>
  );
}

function Editable({
  label,
  workingRule,
  workingAccount,
  resolvedInflationRate,
  onChange,
}: {
  label: string;
  workingRule: SavingsRule;
  workingAccount: Account | undefined;
  resolvedInflationRate: number;
  onChange(m: SolverMutation): void;
}) {
  const [open, setOpen] = useState(false);
  const inputId = `s-${workingRule.id}`;
  const isDollarMode =
    !workingRule.contributeMax &&
    !(workingRule.annualPercent != null && workingRule.annualPercent > 0);
  const altDisplay = workingRule.contributeMax
    ? "IRS max"
    : workingRule.annualPercent != null && workingRule.annualPercent > 0
      ? `${formatPct(workingRule.annualPercent)} of salary`
      : "";

  return (
    <div>
      <label className="block text-[11px] text-ink-3 truncate" htmlFor={inputId}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        {isDollarMode ? (
          <CurrencyAmountInput
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
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            id={inputId}
            className="h-9 w-32 rounded-md border border-hair-2 bg-card-2 px-2.5 text-left text-[14px] text-ink tabular border-l-2 border-l-accent/70 hover:bg-card-hover focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            aria-label={`Edit ${label}`}
          >
            {altDisplay}
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
      </div>
      <DetailLine rule={workingRule} currentYear={new Date().getFullYear()} />
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
