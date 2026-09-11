"use client";

import { useState } from "react";
import { PercentInput } from "@/components/percent-input";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { AutosaveStatus } from "@/components/autosave-status";
import { usePlanSettingsAutosave } from "@/components/forms/use-plan-settings-autosave";
import { fieldLabelClassName, selectClassName } from "@/components/forms/input-styles";
import { useClientAccess } from "@/components/client-access-provider";

interface SurplusCashFlowFormProps {
  clientId: string;
  surplusSpendPct: string;
  surplusSaveAccountId: string | null;
  surplusSpendAllUntilRetirement: boolean;
  householdAccounts: Array<{ id: string; name: string }>;
}

const pct = (v: string) => (Number(v) * 100).toFixed(2);

/** A typed percent → the decimal fraction the API stores. `undefined` while the
 *  box holds something that isn't a number yet. */
function toDecimal(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return "0";
  const n = Number(trimmed);
  return Number.isFinite(n) ? String(n / 100) : undefined;
}

export default function SurplusCashFlowForm({
  clientId,
  surplusSpendPct,
  surplusSaveAccountId,
  surplusSpendAllUntilRetirement,
  householdAccounts,
}: SurplusCashFlowFormProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const { save, state, error, retry } = usePlanSettingsAutosave(clientId);
  const [spendPct, setSpendPct] = useState(pct(surplusSpendPct));
  const [saveAccountId, setSaveAccountId] = useState(surplusSaveAccountId ?? "");
  const [spendAllUntilRetirement, setSpendAllUntilRetirement] = useState(
    surplusSpendAllUntilRetirement,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            Surplus Cash Flow
          </h3>
          <FieldTooltip text="Controls what happens to any positive net cash flow each year, after savings, gifts, and taxes are applied. By default, surplus accumulates in the household checking account." />
        </div>
        {canEdit && <AutosaveStatus state={state} error={error} onRetry={retry} />}
      </div>

      <fieldset disabled={!canEdit} className="m-0 space-y-3 border-0 p-0">
        <div className="grid grid-cols-2 gap-4 rounded-[var(--radius)] border border-hair bg-card p-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="surplusSpendPct">
              Spend % of surplus
            </label>
            <PercentInput
              id="surplusSpendPct"
              value={spendPct}
              onChange={(raw) => {
                setSpendPct(raw);
                const decimal = toDecimal(raw);
                if (decimal !== undefined) save({ surplusSpendPct: decimal });
              }}
            />
            <p className="mt-1 text-[12px] text-ink-3">
              {spendAllUntilRetirement
                ? "Applies from the first retirement year onward."
                : 'The spent portion appears as "Surplus spent" on the Cash Flow report.'}
            </p>
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="surplusSaveAccountId">
              Save remainder to
            </label>
            <select
              id="surplusSaveAccountId"
              value={saveAccountId}
              onChange={(e) => {
                setSaveAccountId(e.target.value);
                save({ surplusSaveAccountId: e.target.value || null });
              }}
              className={selectClassName}
            >
              <option value="">Household checking (default)</option>
              {householdAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={spendAllUntilRetirement}
            onChange={(e) => {
              setSpendAllUntilRetirement(e.target.checked);
              // Explicit boolean, not a FormData read: the route treats an
              // absent key as "don't touch", so an unchecked box has to send
              // `false` or it could never be turned back off.
              save({ surplusSpendAllUntilRetirement: e.target.checked });
            }}
            className="accent-accent"
          />
          Spend all surplus until retirement
          <FieldTooltip text="Treats 100% of each year's surplus as spent through the year before the first person retires. From that retirement year onward, the percentage above applies." />
        </label>
      </fieldset>
    </div>
  );
}
