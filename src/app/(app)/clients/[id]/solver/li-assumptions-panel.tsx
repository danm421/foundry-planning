"use client";

// Life Insurance solver — assumptions input panel (Task 10).
//
// Controlled inputs for the shared LI assumptions. On any change the panel
// lifts the FULL updated `LiAssumptions` object (all 7 fields, `mcTargetScore`
// preserved untouched) to the parent via `onChange`. `mcTargetScore` is NOT
// surfaced here — it belongs to the Monte Carlo block (Task 14).
//
// Styling matches the compact solver-row inputs (see solver-row-*.tsx):
// 9px-tall card-2 inputs, accent left border, 11px ink-3 labels.
import { useState } from "react";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

interface Props {
  assumptions: LiAssumptions;
  onChange(next: LiAssumptions): void;
  /** Household liabilities for the per-liability payoff checklist. */
  liabilities: { id: string; name: string; balance: number }[];
  /** Estate settlement cost from Details > Assumptions (read-only display). */
  estateAdminExpenses: number;
  /** Firm model portfolios for the LI-proceeds growth picker. */
  modelPortfolios: { id: string; name: string }[];
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function LiAssumptionsPanel({
  assumptions,
  onChange,
  liabilities,
  estateAdminExpenses,
  modelPortfolios,
}: Props) {
  const livingKeepUnchanged = assumptions.livingExpenseAtDeath == null;

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium text-ink">Assumptions</div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Death year" htmlFor="li-death-year">
          <YearInput
            id="li-death-year"
            label="Death year"
            value={assumptions.deathYear}
            onCommit={(v) => onChange({ ...assumptions, deathYear: v })}
          />
        </Field>

        <Field label="LI proceeds portfolio" htmlFor="li-model-portfolio">
          <select
            id="li-model-portfolio"
            value={assumptions.modelPortfolioId ?? ""}
            onChange={(e) =>
              onChange({
                ...assumptions,
                modelPortfolioId: e.target.value === "" ? null : e.target.value,
              })
            }
            className="h-9 w-full rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            aria-label="LI proceeds model portfolio"
          >
            <option value="">Plan default rate</option>
            {modelPortfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Leave to heirs" htmlFor="li-leave-heirs">
          <CurrencyAmountInput
            id="li-leave-heirs"
            label="Leave to heirs"
            value={assumptions.leaveToHeirsAmount}
            onCommit={(v) => onChange({ ...assumptions, leaveToHeirsAmount: v })}
          />
        </Field>

        <div className="col-span-2 flex items-center justify-between rounded-md border border-hair bg-card-2 px-3 py-2 text-[11px] text-ink-3">
          <span>Final expenses use the plan&apos;s estate settlement cost.</span>
          <span className="tabular text-ink-2">{usd.format(estateAdminExpenses)}</span>
        </div>

        <div className="col-span-2">
          <Field label="Living expenses at death" htmlFor="li-living-expense">
            <CurrencyAmountInput
              id="li-living-expense"
              label="Living expenses at death"
              value={assumptions.livingExpenseAtDeath ?? 0}
              disabled={livingKeepUnchanged}
              onCommit={(v) =>
                onChange({ ...assumptions, livingExpenseAtDeath: v })
              }
            />
          </Field>
          <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-3">
            <input
              type="checkbox"
              checked={livingKeepUnchanged}
              onChange={(e) =>
                onChange({
                  ...assumptions,
                  livingExpenseAtDeath: e.target.checked
                    ? null
                    : (assumptions.livingExpenseAtDeath ?? 0),
                })
              }
              className="h-3.5 w-3.5 rounded border-hair-2 text-accent focus:ring-2 focus:ring-accent/30"
            />
            Keep current living expenses unchanged
          </label>
        </div>

        <div className="col-span-2">
          <div className="text-[11px] text-ink-3">Pay off at death</div>
          {liabilities.length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-4">No household liabilities.</p>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              {liabilities.map((l) => {
                const checked = assumptions.payoffLiabilityIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className="flex items-center justify-between gap-2 text-[12px] text-ink-2"
                  >
                    <span className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          onChange({
                            ...assumptions,
                            payoffLiabilityIds: e.target.checked
                              ? [...assumptions.payoffLiabilityIds, l.id]
                              : assumptions.payoffLiabilityIds.filter(
                                  (id) => id !== l.id,
                                ),
                          })
                        }
                        className="h-3.5 w-3.5 rounded border-hair-2 text-accent focus:ring-2 focus:ring-accent/30"
                      />
                      {l.name}
                    </span>
                    <span className="tabular text-ink-3">{usd.format(l.balance)}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] text-ink-3 truncate" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Plain numeric stepper for a 4-digit calendar year. */
function YearInput({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const MIN = 1900;
  const MAX = 2200;
  return (
    <input
      id={id}
      type="number"
      min={MIN}
      max={MAX}
      step={1}
      defaultValue={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (!Number.isNaN(n) && n >= MIN && n <= MAX) onCommit(n);
      }}
      className="h-9 w-24 rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      aria-label={label}
    />
  );
}

/** Compact $-prefixed currency input with live thousands formatting. */
function CurrencyAmountInput({
  id,
  label,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
}) {
  const [display, setDisplay] = useState<string>(
    Math.round(value).toLocaleString(),
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
      <span
        className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] ${
          disabled ? "text-ink-4" : "text-ink-3"
        }`}
      >
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        disabled={disabled}
        className="h-9 w-32 rounded-md border border-hair-2 bg-card-2 pl-6 pr-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={label}
      />
    </div>
  );
}
