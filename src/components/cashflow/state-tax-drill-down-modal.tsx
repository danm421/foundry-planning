"use client";

import type { StateIncomeTaxResult } from "@/lib/tax/state-income";
import { USPS_STATE_NAMES } from "@/lib/usps-states";

interface StateTaxDrillDownModalProps {
  year: number;
  state: StateIncomeTaxResult;
  onClose: () => void;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const pctFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface TraceRow {
  label: string;
  amount: number;
  /** "add" rows are subtotals; "sub" rows show as red/negative. */
  kind?: "add" | "sub" | "total" | "neutral";
  hint?: string;
}

function buildTrace(state: StateIncomeTaxResult): TraceRow[] {
  const rows: TraceRow[] = [];
  rows.push({
    label: "Starting income (federal base)",
    amount: state.startingIncome,
    kind: "neutral",
    hint: incomeBaseLabel(state.incomeBase),
  });

  if (state.addbacks.total > 0) {
    if (state.addbacks.taxFreeInterest > 0) {
      rows.push({
        label: "  + Tax-free interest add-back",
        amount: state.addbacks.taxFreeInterest,
        kind: "add",
      });
    }
    if (state.addbacks.other > 0) {
      rows.push({
        label: "  + Other add-backs",
        amount: state.addbacks.other,
        kind: "add",
      });
    }
  }

  if (state.subtractions.total > 0) {
    if (state.subtractions.socialSecurity > 0) {
      rows.push({
        label: "  − Social Security subtraction",
        amount: -state.subtractions.socialSecurity,
        kind: "sub",
      });
    }
    if (state.subtractions.retirementIncome > 0) {
      rows.push({
        label: "  − Retirement-income subtraction",
        amount: -state.subtractions.retirementIncome,
        kind: "sub",
      });
    }
    if (state.subtractions.capitalGains > 0) {
      rows.push({
        label: "  − Capital-gains subtraction",
        amount: -state.subtractions.capitalGains,
        kind: "sub",
      });
    }
    if (state.subtractions.preTaxContrib > 0) {
      rows.push({
        label: "  − Pre-tax contribution subtraction",
        amount: -state.subtractions.preTaxContrib,
        kind: "sub",
      });
    }
    if (state.subtractions.other > 0) {
      rows.push({
        label: "  − Other subtractions",
        amount: -state.subtractions.other,
        kind: "sub",
      });
    }
  }

  rows.push({
    label: "State AGI",
    amount: state.stateAGI,
    kind: "total",
  });

  if (state.stdDeduction > 0) {
    rows.push({
      label: "  − Standard deduction",
      amount: -state.stdDeduction,
      kind: "sub",
    });
  }

  if (state.personalExemptionDeduction > 0) {
    rows.push({
      label: "  − Personal exemption deduction",
      amount: -state.personalExemptionDeduction,
      kind: "sub",
    });
  }

  rows.push({
    label: "State taxable income",
    amount: state.stateTaxableIncome,
    kind: "total",
  });

  rows.push({
    label: "Bracket tax (pre-credit)",
    amount: state.preCreditTax,
    kind: "neutral",
  });

  if (state.exemptionCredits > 0) {
    rows.push({
      label: "  − Exemption credits",
      amount: -state.exemptionCredits,
      kind: "sub",
    });
  }

  rows.push({
    label: "State income tax owed",
    amount: state.stateTax,
    kind: "total",
  });

  return rows;
}

function incomeBaseLabel(base: StateIncomeTaxResult["incomeBase"]): string {
  switch (base) {
    case "federal-agi": return "Federal AGI";
    case "federal-taxable": return "Federal taxable income";
    case "state-gti": return "State gross taxable income";
  }
}

function effectiveRate(state: StateIncomeTaxResult): number {
  if (state.startingIncome <= 0) return 0;
  return state.stateTax / state.startingIncome;
}

export function StateTaxDrillDownModal({
  year,
  state,
  onClose,
}: StateTaxDrillDownModalProps) {
  const stateName = state.state ? USPS_STATE_NAMES[state.state] : "Unknown state";
  const rows = buildTrace(state);
  const filingStatusLabel = filingStatusDisplay(state.filingStatusUsed);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-100">
              {year} · {stateName} State Tax Trace
            </h3>
            <p className="mt-0.5 text-xs text-gray-400">
              Filing status: {filingStatusLabel} · Effective rate {pctFmt.format(effectiveRate(state))}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-300 hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {state.hasIncomeTax === false ? (
          <p className="rounded-md bg-gray-800/40 p-4 text-sm text-gray-300">
            {stateName} does not levy a personal income tax for {year}.
          </p>
        ) : (
          <>
            <div className="mb-1 text-xs uppercase tracking-wide text-gray-400">
              Compute trace
            </div>
            <ul className="divide-y divide-gray-800 rounded-md bg-gray-800/40 text-sm">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className={`flex items-center justify-between px-3 py-2 ${
                    r.kind === "total" ? "font-semibold text-gray-100" : "text-gray-300"
                  } ${r.kind === "sub" ? "text-red-300" : ""} ${
                    r.kind === "add" ? "text-emerald-300" : ""
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="whitespace-pre">{r.label}</span>
                    {r.hint && <span className="text-[11px] text-gray-500">{r.hint}</span>}
                  </span>
                  <span className="tabular-nums">{fmt.format(r.amount)}</span>
                </li>
              ))}
            </ul>

            {state.specialRulesApplied.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  Special rules applied
                </div>
                <ul className="space-y-1 rounded-md bg-gray-800/40 px-3 py-2 text-xs text-gray-300">
                  {state.specialRulesApplied.map((rule, i) => (
                    <li key={i}>• {rule}</li>
                  ))}
                </ul>
              </div>
            )}

            {state.diag.notes.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-400">
                  Diagnostic notes
                </div>
                <ul className="space-y-1 rounded-md bg-gray-800/40 px-3 py-2 text-[11px] italic text-gray-400">
                  {state.diag.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex justify-between border-t border-gray-700 pt-3 text-sm font-semibold text-gray-100">
          <span>State tax owed</span>
          <span className="tabular-nums">{fmt.format(state.stateTax)}</span>
        </div>
      </div>
    </div>
  );
}

function filingStatusDisplay(fs: StateIncomeTaxResult["filingStatusUsed"]): string {
  switch (fs) {
    case "single": return "Single";
    case "married_joint": return "Married filing jointly";
    case "married_separate": return "Married filing separately";
    case "head_of_household": return "Head of household";
  }
}
