"use client";

import { useMemo, useState } from "react";
import type { Account, SavingsRule } from "@/engine/types";
import DialogShell from "@/components/dialog-shell";
import { CurrencyInput } from "@/components/currency-input";
import {
  inputClassName,
  inputBaseClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import {
  supportsEmployerMatch,
  type MatchMode,
  inferMatchMode,
} from "@/components/forms/employer-match-fields";
import {
  supportsPercentContribution,
  supportsMaxContribution,
  type ContributionMode,
  inferContributionMode,
} from "@/components/forms/contribution-amount-fields";
import { supportsDeductibility } from "@/components/forms/deductible-contribution-checkbox";
import { supportsContributionCap } from "@/components/forms/contribution-cap-checkbox";
import type { SolverMutation } from "@/lib/solver/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onEmit: (mutations: SolverMutation[]) => void;
  account: Account;
  workingRule: SavingsRule;
  /** Used as the default rate when switching growth source from custom → inflation. */
  resolvedInflationRate: number;
}

export function SolverSavingsEditDialog({
  open,
  onClose,
  onEmit,
  account,
  workingRule,
  resolvedInflationRate,
}: Props) {
  const showPercentMode = supportsPercentContribution(account.category, account.subType);
  const showMaxMode = supportsMaxContribution(account.category, account.subType);
  const showEmployerMatch = supportsEmployerMatch(account.category, account.subType);
  const showDeductibleToggle = supportsDeductibility(account.category, account.subType);
  const showApplyCapToggle = supportsContributionCap(account.category, account.subType);

  const initialContribMode: ContributionMode = inferContributionMode(
    workingRule.annualPercent != null ? String(workingRule.annualPercent) : null,
    workingRule.contributeMax,
  );
  const initialMatchMode: MatchMode = inferMatchMode(
    workingRule.employerMatchAmount != null
      ? String(workingRule.employerMatchAmount)
      : null,
    workingRule.employerMatchPct != null
      ? String(workingRule.employerMatchPct)
      : null,
  );
  const initialGrowthSource: "custom" | "inflation" =
    workingRule.growthSource === "inflation" ? "inflation" : "custom";

  const [contribMode, setContribMode] = useState<ContributionMode>(initialContribMode);
  const [annualAmount, setAnnualAmount] = useState<string>(
    String(workingRule.annualAmount ?? 0),
  );
  const [annualPercentPct, setAnnualPercentPct] = useState<string>(
    workingRule.annualPercent != null
      ? String(Math.round(workingRule.annualPercent * 10000) / 100)
      : "",
  );

  const [matchMode, setMatchMode] = useState<MatchMode>(initialMatchMode);
  const [matchPct, setMatchPct] = useState<string>(
    workingRule.employerMatchPct != null
      ? String(Math.round(workingRule.employerMatchPct * 10000) / 100)
      : "",
  );
  const [matchCap, setMatchCap] = useState<string>(
    workingRule.employerMatchCap != null
      ? String(Math.round(workingRule.employerMatchCap * 10000) / 100)
      : "",
  );
  const [matchAmount, setMatchAmount] = useState<string>(
    workingRule.employerMatchAmount != null
      ? String(workingRule.employerMatchAmount)
      : "",
  );

  const [growthSource, setGrowthSource] = useState<"custom" | "inflation">(
    initialGrowthSource,
  );
  const [growthRatePct, setGrowthRatePct] = useState<string>(
    workingRule.growthRate != null
      ? String(Math.round(workingRule.growthRate * 10000) / 100)
      : "0",
  );

  const [isDeductible, setIsDeductible] = useState<boolean>(
    workingRule.isDeductible ?? true,
  );
  const [applyCap, setApplyCap] = useState<boolean>(
    workingRule.applyContributionLimit ?? true,
  );

  const [startYear, setStartYear] = useState<number>(workingRule.startYear);
  const [endYear, setEndYear] = useState<number>(workingRule.endYear);

  const title = useMemo(() => `${account.name} Savings`, [account.name]);

  function handleApply() {
    const out: SolverMutation[] = [];
    const accountId = account.id;

    // Contribution mode + amount/percent/max -----------------------------
    if (contribMode === "amount") {
      const next = parseFloat(annualAmount);
      if (!Number.isNaN(next) && next !== workingRule.annualAmount) {
        out.push({ kind: "savings-contribution", accountId, annualAmount: next });
      }
      if ((workingRule.annualPercent ?? null) !== null) {
        out.push({ kind: "savings-annual-percent", accountId, percent: null });
      }
      if ((workingRule.contributeMax ?? false) !== false) {
        out.push({ kind: "savings-contribute-max", accountId, value: false });
      }
    } else if (contribMode === "percent") {
      const pct = parseFloat(annualPercentPct);
      const nextDecimal = Number.isNaN(pct) ? null : pct / 100;
      if (nextDecimal !== (workingRule.annualPercent ?? null)) {
        out.push({
          kind: "savings-annual-percent",
          accountId,
          percent: nextDecimal,
        });
      }
      if ((workingRule.contributeMax ?? false) !== false) {
        out.push({ kind: "savings-contribute-max", accountId, value: false });
      }
    } else {
      // max
      if ((workingRule.contributeMax ?? false) !== true) {
        out.push({ kind: "savings-contribute-max", accountId, value: true });
      }
    }

    // Employer match ----------------------------------------------------
    if (showEmployerMatch) {
      if (matchMode === "none") {
        if ((workingRule.employerMatchPct ?? null) !== null) {
          out.push({
            kind: "savings-employer-match-pct",
            accountId,
            pct: 0,
            cap: null,
          });
        }
        if ((workingRule.employerMatchAmount ?? null) !== null) {
          out.push({
            kind: "savings-employer-match-amount",
            accountId,
            amount: 0,
          });
        }
      } else if (matchMode === "percent") {
        const pctVal = parseFloat(matchPct);
        const capVal = parseFloat(matchCap);
        const pctDecimal = Number.isNaN(pctVal) ? 0 : pctVal / 100;
        const capDecimal = Number.isNaN(capVal) ? null : capVal / 100;
        if (
          pctDecimal !== (workingRule.employerMatchPct ?? null) ||
          capDecimal !== (workingRule.employerMatchCap ?? null)
        ) {
          out.push({
            kind: "savings-employer-match-pct",
            accountId,
            pct: pctDecimal,
            cap: capDecimal,
          });
        }
        if ((workingRule.employerMatchAmount ?? 0) !== 0) {
          out.push({
            kind: "savings-employer-match-amount",
            accountId,
            amount: 0,
          });
        }
      } else {
        const amt = parseFloat(matchAmount);
        const nextAmt = Number.isNaN(amt) ? 0 : amt;
        if (nextAmt !== (workingRule.employerMatchAmount ?? 0)) {
          out.push({
            kind: "savings-employer-match-amount",
            accountId,
            amount: nextAmt,
          });
        }
        if ((workingRule.employerMatchPct ?? 0) !== 0) {
          out.push({
            kind: "savings-employer-match-pct",
            accountId,
            pct: 0,
            cap: null,
          });
        }
      }
    }

    // Growth -----------------------------------------------------------
    if (growthSource !== (workingRule.growthSource === "inflation" ? "inflation" : "custom")) {
      out.push({ kind: "savings-growth-source", accountId, source: growthSource });
    }
    const targetRate =
      growthSource === "inflation"
        ? resolvedInflationRate
        : (parseFloat(growthRatePct) || 0) / 100;
    if (targetRate !== (workingRule.growthRate ?? null)) {
      out.push({ kind: "savings-growth-rate", accountId, rate: targetRate });
    }

    // Deductible / cap toggles -----------------------------------------
    if (showDeductibleToggle && isDeductible !== workingRule.isDeductible) {
      out.push({ kind: "savings-deductible", accountId, value: isDeductible });
    }
    if (
      showApplyCapToggle &&
      applyCap !== (workingRule.applyContributionLimit ?? true)
    ) {
      out.push({ kind: "savings-apply-cap", accountId, value: applyCap });
    }

    // Timeline ---------------------------------------------------------
    if (startYear !== workingRule.startYear) {
      out.push({ kind: "savings-start-year", accountId, year: startYear });
    }
    if (endYear !== workingRule.endYear) {
      out.push({ kind: "savings-end-year", accountId, year: endYear });
    }

    if (out.length > 0) onEmit(out);
    onClose();
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      size="md"
      primaryAction={{ label: "Apply", onClick: handleApply }}
    >
      {/* Contribution mode */}
      <fieldset className="mb-4">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">
          Contribution
        </legend>
        <div className="flex gap-1 text-xs mb-3">
          <ModeButton
            active={contribMode === "amount"}
            onClick={() => setContribMode("amount")}
          >
            Dollar amount
          </ModeButton>
          {showPercentMode && (
            <ModeButton
              active={contribMode === "percent"}
              onClick={() => setContribMode("percent")}
            >
              % of salary
            </ModeButton>
          )}
          {showMaxMode && (
            <ModeButton
              active={contribMode === "max"}
              onClick={() => setContribMode("max")}
            >
              Max (IRS limit)
            </ModeButton>
          )}
        </div>

        {contribMode === "amount" && (
          <div>
            <label className={fieldLabelClassName}>Annual amount</label>
            <CurrencyInput
              value={annualAmount}
              onChange={(raw) => setAnnualAmount(raw)}
            />
          </div>
        )}
        {contribMode === "percent" && (
          <div>
            <label className={fieldLabelClassName}>% of salary</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={annualPercentPct}
              onChange={(e) => setAnnualPercentPct(e.target.value)}
              placeholder="e.g. 10"
              className={inputBaseClassName + " w-32"}
            />
            <p className="text-[12px] text-ink-3 mt-1">
              Resolves against the account owner&rsquo;s salary each year.
            </p>
          </div>
        )}
        {contribMode === "max" && (
          <p className="text-[13px] text-ink-3">
            Contributes the IRS limit each year for the owner&rsquo;s age
            (base + catch-up where applicable).
          </p>
        )}
      </fieldset>

      {/* Employer match */}
      {showEmployerMatch && (
        <fieldset className="mb-4">
          <legend className="text-[12px] font-medium text-ink-2 mb-2">
            Employer match
          </legend>
          <div className="flex gap-1 text-xs mb-3">
            <ModeButton
              active={matchMode === "none"}
              onClick={() => setMatchMode("none")}
            >
              None
            </ModeButton>
            <ModeButton
              active={matchMode === "percent"}
              onClick={() => setMatchMode("percent")}
            >
              % of salary
            </ModeButton>
            <ModeButton
              active={matchMode === "flat"}
              onClick={() => setMatchMode("flat")}
            >
              Flat $
            </ModeButton>
          </div>
          {matchMode === "percent" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabelClassName}>Match rate (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={matchPct}
                  onChange={(e) => setMatchPct(e.target.value)}
                  placeholder="e.g. 50"
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={fieldLabelClassName}>
                  Cap (% of salary)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={matchCap}
                  onChange={(e) => setMatchCap(e.target.value)}
                  placeholder="e.g. 6"
                  className={inputClassName}
                />
              </div>
              <p className="col-span-2 text-[12px] text-ink-3">
                No cap → rate × salary. With cap → rate × cap × salary.
              </p>
            </div>
          )}
          {matchMode === "flat" && (
            <div>
              <label className={fieldLabelClassName}>Flat annual amount</label>
              <div className="w-40">
                <CurrencyInput
                  value={matchAmount}
                  onChange={(raw) => setMatchAmount(raw)}
                  placeholder="5000"
                />
              </div>
            </div>
          )}
        </fieldset>
      )}

      {/* Growth */}
      <fieldset className="mb-4">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">
          Growth
        </legend>
        <div className="flex gap-1 text-xs mb-3">
          <ModeButton
            active={growthSource === "custom"}
            onClick={() => setGrowthSource("custom")}
          >
            Custom %
          </ModeButton>
          <ModeButton
            active={growthSource === "inflation"}
            onClick={() => setGrowthSource("inflation")}
          >
            Inflation-linked
          </ModeButton>
        </div>
        {growthSource === "custom" ? (
          <div>
            <label className={fieldLabelClassName}>Annual growth rate (%)</label>
            <input
              type="number"
              step={0.25}
              value={growthRatePct}
              onChange={(e) => setGrowthRatePct(e.target.value)}
              className={inputBaseClassName + " w-32"}
            />
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">
            Follows the plan&rsquo;s inflation rate (
            {(resolvedInflationRate * 100).toFixed(2)}% currently).
          </p>
        )}
      </fieldset>

      {/* Tax / cap toggles */}
      {(showDeductibleToggle || showApplyCapToggle) && (
        <fieldset className="mb-4 space-y-2">
          <legend className="text-[12px] font-medium text-ink-2 mb-2">
            Tax treatment
          </legend>
          {showDeductibleToggle && (
            <label className="flex items-start gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={isDeductible}
                onChange={(e) => setIsDeductible(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Contribution is tax-deductible (pre-tax)
                <span className="block text-[12px] text-ink-3">
                  Uncheck for after-tax / non-deductible contributions.
                </span>
              </span>
            </label>
          )}
          {showApplyCapToggle && (
            <label className="flex items-start gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={applyCap}
                onChange={(e) => setApplyCap(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Apply IRS contribution limit
                <span className="block text-[12px] text-ink-3">
                  When on, caps the contribution at the applicable IRS limit
                  (including age-50+ catch-up).
                </span>
              </span>
            </label>
          )}
        </fieldset>
      )}

      {/* Timeline */}
      <fieldset className="mb-2">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">
          Timeline
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName}>Start year</label>
            <input
              type="number"
              min={1950}
              max={2150}
              value={startYear}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) setStartYear(n);
              }}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName}>End year</label>
            <input
              type="number"
              min={1950}
              max={2150}
              value={endYear}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isNaN(n)) setEndYear(n);
              }}
              className={inputClassName}
            />
          </div>
        </div>
      </fieldset>
    </DialogShell>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
        active
          ? "border-accent bg-accent/15 text-accent-ink"
          : "border-hair-2 bg-card-2 text-ink-2 hover:bg-card-hover"
      }`}
    >
      {children}
    </button>
  );
}
