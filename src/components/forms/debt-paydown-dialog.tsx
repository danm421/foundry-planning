"use client";

import { useMemo, useState } from "react";
import type { Liability } from "@/engine/types";
import DialogShell from "@/components/dialog-shell";
import { CurrencyInput } from "@/components/currency-input";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { inputBaseClassName, selectClassName } from "./input-styles";
import { usd } from "@/lib/solver/technique-summaries";
import {
  isPaydownEligible,
  normalizeDebtPaydownRow,
  previewDebtPaydown,
  type DebtPaydownFrequency,
  type DebtPaydownPreview,
  type DebtPaydownRow,
} from "@/lib/solver/debt-paydown";

/** Grid template shared by the header, every loan row, and the totals row. */
const GRID = "grid grid-cols-[minmax(0,1fr)_112px_116px_196px_180px] items-center gap-x-3";

const FREQUENCY_LABEL: Record<DebtPaydownFrequency, string> = {
  one_time: "One time",
  monthly: "Monthly",
  annual: "Annually",
};

interface Draft {
  amount: string;
  frequency: DebtPaydownFrequency;
  startYear: string;
  endYear: string;
  /** Carried through untouched so editing amounts never silently re-enables a
   *  paydown the advisor switched off in the technique list. */
  enabled?: boolean;
}

function draftToRow(liabilityId: string, d: Draft): DebtPaydownRow | null {
  const amount = Number(d.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const startYear = Number(d.startYear);
  const endYear = Number(d.endYear);
  if (!Number.isFinite(startYear)) return null;
  return {
    liabilityId,
    frequency: d.frequency,
    amount,
    startYear,
    endYear: Math.max(startYear, endYear || startYear),
    ...(d.enabled === false ? { enabled: false } : {}),
  };
}

interface Props {
  /** Every liability on the working tree — ineligible ones are listed, not hidden. */
  liabilities: Liability[];
  /** Existing paydowns keyed by liability id. */
  rows: Record<string, DebtPaydownRow>;
  /** Earliest year a paydown may start (the plan's first year). */
  minYear: number;
  onClose: () => void;
  /** One entry per loan whose plan changed. `value: null` clears it. */
  onSubmit: (changes: { liabilityId: string; value: DebtPaydownRow | null }[]) => void;
}

export default function DebtPaydownDialog({
  liabilities,
  rows,
  minYear,
  onClose,
  onSubmit,
}: Props) {
  const eligible = useMemo(() => liabilities.filter(isPaydownEligible), [liabilities]);
  const ineligible = useMemo(() => liabilities.filter((l) => !isPaydownEligible(l)), [liabilities]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const out: Record<string, Draft> = {};
    for (const liab of eligible) {
      const existing = rows[liab.id];
      const payoff = previewDebtPaydown(liab, null).basePayoffYear;
      out[liab.id] = existing
        ? {
            amount: String(existing.amount),
            frequency: existing.frequency,
            startYear: String(existing.startYear),
            endYear: String(existing.endYear),
            enabled: existing.enabled,
          }
        : {
            amount: "",
            frequency: "monthly",
            startYear: String(Math.max(minYear, liab.startYear)),
            // Default the window to "until this loan is paid off".
            endYear: String(payoff ?? minYear),
          };
    }
    return out;
  });

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  /** Row + live preview for every eligible loan, recomputed as the table is typed in. */
  const previews = useMemo(
    () =>
      eligible.map((liab) => {
        const row = draftToRow(liab.id, drafts[liab.id]);
        return { liab, row, preview: previewDebtPaydown(liab, row) };
      }),
    [eligible, drafts],
  );

  const funded = previews.filter((p) => p.row != null);
  const totalApplied = funded.reduce((s, p) => s + p.preview.appliedTotal, 0);
  const totalSaved = funded.reduce((s, p) => s + p.preview.interestSaved, 0);

  function handleSubmit() {
    const changes: { liabilityId: string; value: DebtPaydownRow | null }[] = [];
    for (const { liab, row } of previews) {
      // Trim the stored plan to what the loan can actually absorb, so a
      // re-opened dialog and the summary chip say what will really happen.
      const next = row ? normalizeDebtPaydownRow(liab, row) : null;
      const prev = rows[liab.id] ?? null;
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        changes.push({ liabilityId: liab.id, value: next });
      }
    }
    onSubmit(changes);
    onClose();
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Debt Paydown"
      size="lg"
      primaryAction={{
        label: "Save changes",
        onClick: handleSubmit,
        disabled: eligible.length === 0,
      }}
    >
      {eligible.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-ink-3">
          This plan has no amortizing loans to pay down.
        </p>
      ) : (
        <div>
          {/* Column headers */}
          <div className={`${GRID} border-b border-hair pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3`}>
            <span>Loan</span>
            <span className="flex items-center gap-1.5">
              Extra
              <FieldTooltip text="Extra principal on top of the scheduled payment — every month (Monthly), once each year (Annually), or a single payment (One time). Payments stop the year the balance reaches zero, so a loan is never overpaid." />
            </span>
            <span>Frequency</span>
            <span>Years</span>
            <span className="text-right">Payoff · saved</span>
          </div>

          {previews.map(({ liab, row, preview }) => {
            const d = drafts[liab.id];
            return (
              <div key={liab.id} className={`${GRID} border-b border-hair py-2.5`}>
                {/* Loan */}
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{liab.name}</div>
                  <div className="tabular truncate text-[11px] text-ink-3">
                    {usd(liab.balance)} · {(liab.interestRate * 100).toFixed(2)}%
                  </div>
                </div>

                {/* Extra amount */}
                <CurrencyInput
                  value={d.amount}
                  onChange={(raw) => update(liab.id, { amount: raw })}
                  placeholder="0"
                  aria-label={`Extra payment for ${liab.name}`}
                  className="tabular"
                />

                {/* Frequency */}
                <select
                  value={d.frequency}
                  onChange={(e) =>
                    update(liab.id, { frequency: e.target.value as DebtPaydownFrequency })
                  }
                  aria-label={`Frequency for ${liab.name}`}
                  className={selectClassName}
                >
                  {(Object.keys(FREQUENCY_LABEL) as DebtPaydownFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABEL[f]}
                    </option>
                  ))}
                </select>

                {/* Years */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={minYear}
                    max={minYear + 80}
                    value={d.startYear}
                    onChange={(e) => update(liab.id, { startYear: e.target.value })}
                    aria-label={`Start year for ${liab.name}`}
                    className={`tabular w-[88px] ${inputBaseClassName}`}
                  />
                  {d.frequency === "one_time" ? null : (
                    <>
                      <span className="text-[12px] text-ink-4">–</span>
                      <input
                        type="number"
                        min={minYear}
                        max={minYear + 80}
                        value={d.endYear}
                        onChange={(e) => update(liab.id, { endYear: e.target.value })}
                        aria-label={`End year for ${liab.name}`}
                        className={`tabular w-[88px] ${inputBaseClassName}`}
                      />
                    </>
                  )}
                </div>

                {/* Impact */}
                <ImpactCell active={row != null} preview={preview} />
              </div>
            );
          })}

          {/* Totals */}
          <div className={`${GRID} pt-2.5 text-[12px]`}>
            <span className="text-ink-2">
              {funded.length === 0
                ? "No extra payments yet"
                : `${funded.length} of ${eligible.length} ${eligible.length === 1 ? "loan" : "loans"}`}
            </span>
            <span />
            <span />
            <span />
            <div className="text-right">
              {funded.length > 0 ? (
                <>
                  <div className="tabular text-[13px] font-medium text-good">
                    saves {usd(totalSaved)}
                  </div>
                  <div className="tabular text-[11px] text-ink-3">{usd(totalApplied)} applied</div>
                </>
              ) : (
                <span className="text-ink-4">—</span>
              )}
            </div>
          </div>

          {ineligible.length > 0 ? (
            <p className="mt-4 text-[11px] leading-relaxed text-ink-4">
              Not shown: {ineligible.map((l) => l.name).join(", ")} — revolving and
              no-term balances have no payoff schedule to shorten.
            </p>
          ) : null}
        </div>
      )}
    </DialogShell>
  );
}

function ImpactCell({ active, preview }: { active: boolean; preview: DebtPaydownPreview }) {
  if (!active || preview.newPayoffYear == null) {
    return <span className="text-right text-[12px] text-ink-4">—</span>;
  }
  return (
    <div className="text-right">
      <div className="tabular text-[13px] text-ink">
        {preview.yearsSaved > 0 ? (
          <>
            <span className="text-ink-3">{preview.basePayoffYear}</span>
            <span className="px-1 text-ink-4">→</span>
            {preview.newPayoffYear}
          </>
        ) : (
          preview.newPayoffYear
        )}
      </div>
      <div className="tabular text-[11px] text-good">saves {usd(preview.interestSaved)}</div>
      {preview.capped ? (
        <div className="tabular text-[11px] text-ink-3">
          {usd(preview.appliedTotal)} of {usd(preview.requestedTotal)}
        </div>
      ) : null}
    </div>
  );
}
