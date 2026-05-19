"use client";

// Life Insurance solver — assumptions input panel.
//
// Controlled inputs for the shared LI assumptions. On any change the panel
// lifts the FULL updated `LiAssumptions` object (all 6 fields, `mcTargetScore`
// preserved untouched) to the parent via `onChange`. `mcTargetScore` is NOT
// surfaced here — it belongs to the Monte Carlo block.
//
// Rendered as a compact card beneath the solved need range. Inputs fill their
// grid column (`w-full`) so the panel reads as a tidy data-entry form rather
// than tiny fields floating in dead space.
import { useState } from "react";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

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

export function LiAssumptionsPanel({
  assumptions,
  onChange,
  liabilities,
  estateAdminExpenses,
  modelPortfolios,
}: Props) {
  const livingKeepUnchanged = assumptions.livingExpenseAtDeath == null;

  return (
    <div className="rounded-lg border border-hair bg-card p-3">
      <div className="text-[13px] font-medium text-ink">Assumptions</div>

      <div className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
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

        <div>
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
          <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[11px] text-ink-3">
            <Checkbox
              checked={livingKeepUnchanged}
              ariaLabel="Keep current living expenses unchanged"
              onChange={(next) =>
                onChange({
                  ...assumptions,
                  livingExpenseAtDeath: next
                    ? null
                    : (assumptions.livingExpenseAtDeath ?? 0),
                })
              }
            />
            Keep current living expenses unchanged
          </label>
        </div>

        <div className="flex items-center justify-between rounded-md border border-hair bg-card-2 px-2.5 py-1.5 text-[11px] text-ink-3 sm:col-span-2">
          <span>Final expenses use the plan&apos;s estate settlement cost.</span>
          <span className="tabular text-ink-2">{formatCurrency(estateAdminExpenses)}</span>
        </div>

        <div className="sm:col-span-2">
          <div className="text-[11px] text-ink-3">Pay off at death</div>
          {liabilities.length === 0 ? (
            <p className="mt-1 text-[11px] text-ink-4">No household liabilities.</p>
          ) : (
            <div className="mt-1.5 divide-y divide-hair rounded-md border border-hair bg-card-2">
              {liabilities.map((l) => {
                const checked = assumptions.payoffLiabilityIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-[12px] text-ink-2 transition-colors hover:bg-card-hover"
                  >
                    <span className="flex items-center gap-2">
                      <Checkbox
                        checked={checked}
                        ariaLabel={`Pay off ${l.name} at death`}
                        onChange={(next) =>
                          onChange({
                            ...assumptions,
                            payoffLiabilityIds: next
                              ? [...assumptions.payoffLiabilityIds, l.id]
                              : assumptions.payoffLiabilityIds.filter(
                                  (id) => id !== l.id,
                                ),
                          })
                        }
                      />
                      {l.name}
                    </span>
                    <span className="tabular text-ink-3">{formatCurrency(l.balance)}</span>
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
      <label className="block truncate text-[11px] text-ink-3" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Themed checkbox — the native control is hidden (`appearance-none`) and styled
 * directly: a card-2 box with a hair border that fills accent with a white
 * check when on. Matches the dark solver theme; native checkboxes do not.
 */
function Checkbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-hair-2 bg-card-2 transition-colors hover:border-accent/60 checked:border-accent checked:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="pointer-events-none absolute h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100"
      >
        <path
          d="M2.5 6.25 5 8.75l4.5-5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
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
      className="h-9 w-full rounded-md border border-hair-2 bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
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
        className="h-9 w-full rounded-md border border-hair-2 bg-card-2 pl-6 pr-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={label}
      />
    </div>
  );
}
