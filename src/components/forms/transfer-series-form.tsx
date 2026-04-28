"use client";

import { useState } from "react";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import { CurrencyInput } from "@/components/currency-input";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "./input-styles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountOption {
  id: string;
  name: string;
  isDefaultChecking: boolean;
}

interface Props {
  clientId: string;
  trustId: string;
  trustGrantor: "client" | "spouse";
  accounts: AccountOption[];
  milestones?: ClientMilestones;
  currentYear: number;
  onClose: () => void;
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TransferSeriesForm({
  clientId,
  trustId,
  trustGrantor,
  accounts,
  milestones,
  currentYear,
  onClose,
  onSaved,
}: Props) {
  const fallbackMilestones: ClientMilestones = milestones ?? {
    planStart: currentYear,
    planEnd: currentYear + 50,
    clientRetirement: currentYear + 30,
    clientEnd: currentYear + 50,
  };

  // Default source account: prefer default-checking, else first account
  const defaultAccountId =
    accounts.find((a) => a.isDefaultChecking)?.id ?? accounts[0]?.id ?? "";

  // Form state
  const [annualAmount, setAnnualAmount] = useState("");
  const [startYear, setStartYear] = useState(currentYear);
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(null);
  const [endYear, setEndYear] = useState(currentYear + 10);
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(null);
  const [grantor, setGrantor] = useState<"client" | "spouse">(trustGrantor);
  const [inflationAdjust, setInflationAdjust] = useState(false);
  const [useCrummeyPowers, setUseCrummeyPowers] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState(defaultAccountId);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Validation
  const amountNum = Number(annualAmount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const endYearValid = endYear >= startYear;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amountValid || !endYearValid) return;
    setSaving(true);
    setError(null);
    try {
      // sourceAccountId is UI-only — not included in POST body
      const body = {
        grantor,
        recipientEntityId: trustId,
        startYear,
        startYearRef,
        endYear,
        endYearRef,
        annualAmount: Number(annualAmount),
        inflationAdjust,
        useCrummeyPowers,
        notes: notes || null,
      };

      const res = await fetch(`/api/clients/${clientId}/gifts/series`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="transfer-series-form" onSubmit={submit} className="flex flex-col gap-4">
      {/* Annual amount */}
      <div>
        <label htmlFor="series-amount" className={fieldLabelClassName}>
          Annual gift amount
        </label>
        <CurrencyInput
          id="series-amount"
          value={annualAmount}
          onChange={setAnnualAmount}
          placeholder="e.g. 18,000"
        />
      </div>

      {/* Start year */}
      <MilestoneYearPicker
        name="startYear"
        id="series-start-year"
        value={startYear}
        yearRef={startYearRef}
        milestones={fallbackMilestones}
        onChange={(yr, ref) => {
          setStartYear(yr);
          setStartYearRef(ref);
        }}
        label="Start year"
      />

      {/* End year */}
      <MilestoneYearPicker
        name="endYear"
        id="series-end-year"
        value={endYear}
        yearRef={endYearRef}
        milestones={fallbackMilestones}
        onChange={(yr, ref) => {
          setEndYear(yr);
          setEndYearRef(ref);
        }}
        label="End year"
        startYearForDuration={startYear}
      />

      {/* Inline year validation */}
      {!endYearValid && (
        <div
          role="status"
          aria-live="polite"
          aria-label="End year must be ≥ start year"
          className="text-xs text-red-400"
        >
          End year must be ≥ start year.
        </div>
      )}

      {/* Grantor radio */}
      <div>
        <span id="grantor-label" className={fieldLabelClassName}>Grantor</span>
        <div role="radiogroup" aria-labelledby="grantor-label" className="mt-1 flex gap-4 text-sm text-ink">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={grantor === "client"}
              onChange={() => setGrantor("client")}
              className="accent-accent"
            />
            Client
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={grantor === "spouse"}
              onChange={() => setGrantor("spouse")}
              className="accent-accent"
            />
            Spouse
          </label>
        </div>
      </div>

      {/* Inflation adjust */}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={inflationAdjust}
          onChange={(e) => setInflationAdjust(e.target.checked)}
          className="accent-accent"
        />
        Inflation-adjust gift amount annually
      </label>

      {/* Crummey powers */}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={useCrummeyPowers}
          onChange={(e) => setUseCrummeyPowers(e.target.checked)}
          className="accent-accent"
        />
        Use Crummey powers (beneficiary withdrawal right)
      </label>

      {/* Source account (UI-only) */}
      {accounts.length > 0 && (
        <div>
          <label htmlFor="series-source-account" className={fieldLabelClassName}>
            Source account (informational only)
          </label>
          <select
            id="series-source-account"
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value)}
            className={selectClassName}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Notes */}
      <div>
        <label htmlFor="series-notes" className={fieldLabelClassName}>
          Notes (optional)
        </label>
        <textarea
          id="series-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={textareaClassName}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400">{error}</div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className={`${inputClassName} w-auto px-4 text-sm`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !amountValid || !endYearValid}
          className="rounded-[var(--radius-sm)] bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
