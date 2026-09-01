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
  supportsRothSplit,
  type ContributionMode,
  inferContributionMode,
} from "@/components/forms/contribution-amount-fields";
import { supportsDeductibility } from "@/components/forms/deductible-contribution-checkbox";
import { supportsContributionCap } from "@/components/forms/contribution-cap-checkbox";
import SalaryBasisFields, {
  inferSalaryBasis,
  type SalaryBasisValue,
  type SalaryOption,
} from "@/components/forms/salary-basis-fields";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import { coerceYearRef, type ClientMilestones, type YearRef } from "@/lib/milestones";
import type { SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import type { AccountAssetMix } from "@/engine/monteCarlo/trial";
import type { SolverMutation } from "@/lib/solver/types";
import {
  SolverAccountGrowthSelect,
  accountGrowthSelectValue,
  resolveAccountGrowthChoice,
} from "./solver-account-growth-select";

interface Props {
  open: boolean;
  onClose: () => void;
  onEmit: (mutations: SolverMutation[]) => void;
  account: Account;
  workingRule: SavingsRule;
  /** Used as the default rate when switching growth source from custom → inflation. */
  resolvedInflationRate: number;
  /** The plan's salaries, for the "which salaries?" panel. Built by the parent
   *  row from the WORKING tree, so a salary added this session is selectable. */
  salaries?: readonly SalaryOption[];
  /** The firm's model portfolios, for the account-growth picker. */
  portfolios?: readonly SolverModelPortfolio[];
  /** The plan's resolved default growth rate for this account's category, or
   *  null when the plan has no default to name for it. */
  categoryDefaultRate?: number | null;
  /** Register the picked portfolio's asset mix so Monte Carlo randomizes this
   *  account on that allocation instead of the flat deterministic rate. */
  registerAccountMix?: (accountId: string, mix: AccountAssetMix[]) => void;
  /** Resolved household milestones, for the Timeline year pickers. */
  milestones: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}

export function SolverSavingsEditDialog({
  open,
  onClose,
  onEmit,
  account,
  workingRule,
  resolvedInflationRate,
  salaries,
  portfolios,
  categoryDefaultRate,
  registerAccountMix,
  milestones,
  clientFirstName,
  spouseFirstName,
}: Props) {
  const showPercentMode = supportsPercentContribution(account.category, account.subType);
  const showMaxMode = supportsMaxContribution(account.category, account.subType);
  const showEmployerMatch = supportsEmployerMatch(account.category, account.subType);
  const showDeductibleToggle = supportsDeductibility(account.category, account.subType);
  const showApplyCapToggle = supportsContributionCap(account.category, account.subType);
  const showRothSplit = supportsRothSplit(account.category, account.subType);

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

  const initialRoth = workingRule.rothPercent ?? 0;
  const initialRothMode: "pretax" | "roth" | "split" =
    initialRoth <= 0 ? "pretax" : initialRoth >= 1 ? "roth" : "split";
  const [rothMode, setRothMode] = useState<"pretax" | "roth" | "split">(
    initialRothMode,
  );
  const [rothSplitPct, setRothSplitPct] = useState<string>(
    String(Math.round(initialRoth * 100)),
  );

  const [startYear, setStartYear] = useState<number>(workingRule.startYear);
  const [endYear, setEndYear] = useState<number>(workingRule.endYear);
  // coerced, not cast: the engine types these as opaque strings, so a stale or
  // hand-edited token would otherwise reach MilestoneYearPicker as a valid ref.
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    coerceYearRef(workingRule.startYearRef) ?? null,
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    coerceYearRef(workingRule.endYearRef) ?? null,
  );

  // Account growth. Seeded from the account's stored basis; `null` means it is
  // on a source this picker cannot offer (a custom rate, a per-account asset
  // mix, holdings) and the select shows "as entered" until the advisor moves it.
  const growthPortfolios = portfolios ?? [];
  const initialGrowthValue = accountGrowthSelectValue(
    account,
    growthPortfolios,
    categoryDefaultRate ?? null,
  );
  const [accountGrowthValue, setAccountGrowthValue] = useState<string | null>(
    initialGrowthValue,
  );

  const initialSalaryBasis = inferSalaryBasis(
    workingRule.salaryBasis,
    workingRule.salaryIncomeIds,
  );
  const [salaryBasis, setSalaryBasis] = useState<SalaryBasisValue>(initialSalaryBasis);

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

    // Roth designation -------------------------------------------------
    if (showRothSplit) {
      let nextRoth: number;
      if (rothMode === "pretax") {
        nextRoth = 0;
      } else if (rothMode === "roth") {
        nextRoth = 1;
      } else {
        const pct = parseFloat(rothSplitPct);
        nextRoth = Number.isNaN(pct)
          ? 0
          : Math.round(Math.min(100, Math.max(0, pct))) / 100;
      }
      if (nextRoth !== (workingRule.rothPercent ?? 0)) {
        out.push({ kind: "savings-roth-percent", accountId, rothPercent: nextRoth });
      }
    }

    // Timeline ---------------------------------------------------------
    // The ref rides with the year, so anchoring to "Rachel Retirement" survives
    // the save and re-anchors when her retirement date later moves. Emitted when
    // EITHER the year or the anchor changed — switching from a milestone to the
    // same hand-typed year still has to clear the ref.
    const baseStartRef = coerceYearRef(workingRule.startYearRef) ?? null;
    const baseEndRef = coerceYearRef(workingRule.endYearRef) ?? null;
    if (startYear !== workingRule.startYear || startYearRef !== baseStartRef) {
      out.push({ kind: "savings-start-year", accountId, year: startYear, ref: startYearRef });
    }
    if (endYear !== workingRule.endYear || endYearRef !== baseEndRef) {
      out.push({ kind: "savings-end-year", accountId, year: endYear, ref: endYearRef });
    }

    // Account growth ----------------------------------------------------
    // Rewrites the whole account (there is no per-field account lever), so it
    // is emitted only on an actual change — an upsert of an unchanged account
    // would still re-materialize its owner rows on Save-to-base.
    if (accountGrowthValue !== null && accountGrowthValue !== initialGrowthValue) {
      const choice = resolveAccountGrowthChoice(
        accountGrowthValue,
        growthPortfolios,
        categoryDefaultRate ?? null,
      );
      if (choice) {
        out.push({
          kind: "account-upsert",
          id: accountId,
          value: {
            ...account,
            growthRate: choice.growthRate,
            realization: choice.realization,
            growthSource: choice.growthSource,
            modelPortfolioId: choice.modelPortfolioId,
          },
        });
        registerAccountMix?.(accountId, choice.mix);
      }
    }

    // Salary basis -----------------------------------------------------
    // Element-wise, not a bare `!==`: two arrays are never equal by identity,
    // so a plain compare would emit a no-op mutation on every save and spend
    // one of the 30/min-per-firm projection recomputes for nothing.
    const idsChanged =
      initialSalaryBasis.incomeIds.length !== salaryBasis.incomeIds.length ||
      initialSalaryBasis.incomeIds.some((id, i) => id !== salaryBasis.incomeIds[i]);
    if (initialSalaryBasis.basis !== salaryBasis.basis || idsChanged) {
      out.push({
        kind: "savings-salary-basis",
        accountId,
        basis: salaryBasis.basis,
        incomeIds: salaryBasis.incomeIds,
      });
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

      {/* Account growth — what the BALANCE earns. Placed above contribution
          growth because it is the number advisors come here looking for. */}
      {growthPortfolios.length > 0 || categoryDefaultRate != null ? (
        <fieldset className="mb-4">
          <legend className="text-[12px] font-medium text-ink-2 mb-2">
            Account growth
          </legend>
          <SolverAccountGrowthSelect
            id={`solver-acct-growth-${account.id}`}
            label="Grows at"
            value={accountGrowthValue}
            portfolios={growthPortfolios}
            categoryDefaultRate={categoryDefaultRate ?? null}
            currentRate={account.growthRate}
            onChange={setAccountGrowthValue}
          />
        </fieldset>
      ) : null}

      {/* Contribution growth — how the yearly CONTRIBUTION escalates. */}
      <fieldset className="mb-4">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">
          Contribution growth
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
            <label className={fieldLabelClassName}>
              Contribution increases per year (%)
            </label>
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
            The contribution rises with the plan&rsquo;s inflation rate (
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

      {/* Roth treatment */}
      {showRothSplit && (
        <fieldset className="mb-4">
          <legend className="text-[12px] font-medium text-ink-2 mb-2">
            Roth treatment
          </legend>
          <div className="flex gap-1 text-xs mb-3">
            <ModeButton
              active={rothMode === "pretax"}
              onClick={() => setRothMode("pretax")}
            >
              Pre-tax
            </ModeButton>
            <ModeButton
              active={rothMode === "roth"}
              onClick={() => setRothMode("roth")}
            >
              Roth
            </ModeButton>
            <ModeButton
              active={rothMode === "split"}
              onClick={() => setRothMode("split")}
            >
              Split
            </ModeButton>
          </div>
          {rothMode === "split" && (
            <div>
              <label className={fieldLabelClassName}>Roth share (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={rothSplitPct}
                onChange={(e) => setRothSplitPct(e.target.value)}
                placeholder="e.g. 40"
                className={inputBaseClassName + " w-32"}
              />
              <p className="text-[12px] text-ink-3 mt-1">
                Share of the contribution designated Roth; the rest is pre-tax.
              </p>
            </div>
          )}
        </fieldset>
      )}

      {/* Timeline — the same anchored pickers the cash-flow rows use
          ("Rachel Retirement", "Last Year", a duration). */}
      <fieldset className="mb-2">
        <legend className="text-[12px] font-medium text-ink-2 mb-2">
          Timeline
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <MilestoneYearPicker
            id={`solver-sr-start-${account.id}`}
            name="startYear"
            label="Start year"
            value={startYear}
            yearRef={startYearRef}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
            position="start"
            onChange={(y, ref) => {
              setStartYear(y);
              setStartYearRef(ref);
            }}
          />
          <MilestoneYearPicker
            id={`solver-sr-end-${account.id}`}
            name="endYear"
            label="End year"
            value={endYear}
            yearRef={endYearRef}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
            position="end"
            startYearForDuration={startYear}
            onChange={(y, ref) => {
              setEndYear(y);
              setEndYearRef(ref);
            }}
          />
        </div>
        {endYear < startYear && (
          <p className="mt-2 text-[12px] text-warn">
            End year is before the start year — this rule contributes nothing.
          </p>
        )}
      </fieldset>

      {/* Placed last, not beside the toggles it responds to: the panel is
          conditionally rendered, so up beside the contribution and match modes
          it would appear and disappear in the MIDDLE of the dialog and shove
          the year pickers up and down on every mode toggle. */}
      {(contribMode === "percent" || (showEmployerMatch && matchMode === "percent")) && (
        <div className="mt-4">
          <SalaryBasisFields
            value={salaryBasis}
            onChange={setSalaryBasis}
            salaries={salaries ?? []}
            idPrefix="solver-sr"
          />
        </div>
      )}
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
