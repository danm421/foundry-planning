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

interface HouseholdAccount {
  id: string;
  name: string;
  isDefaultChecking: boolean;
}

interface Props {
  clientId: string;
  trustId: string;
  trustGrantor: "client" | "spouse";
  /** Shown in the source-account dropdown (UI-only — not sent in POST body). */
  accounts: HouseholdAccount[];
  milestones?: ClientMilestones;
  /** Current calendar year — passed as a prop so tests can control it. */
  currentYear: number;
  onClose: () => void;
  onSaved: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TransferCashForm({
  clientId,
  trustId,
  trustGrantor,
  accounts,
  milestones,
  currentYear,
  onClose,
  onSaved,
}: Props) {
  const defaultSourceId =
    accounts.find((a) => a.isDefaultChecking)?.id ?? accounts[0]?.id ?? "";

  const [amount, setAmount] = useState("");
  const [year, setYear] = useState(currentYear);
  const [yearRef, setYearRef] = useState<YearRef | null>(null);
  const [grantor, setGrantor] = useState<"client" | "spouse">(trustGrantor);
  const [useCrummeyPowers, setUseCrummeyPowers] = useState(false);
  // sourceAccountId is UI-only — shown for informational context but NOT sent in the POST body.
  // The gifts schema has no sourceAccountId field; the server ignores it if sent. We keep it
  // out of the body to stay explicit about the cash-gift schema branch.
  const [sourceAccountId, setSourceAccountId] = useState(defaultSourceId);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;

  const fallbackMilestones: ClientMilestones = milestones ?? {
    planStart: currentYear,
    planEnd: currentYear + 50,
    clientRetirement: currentYear + 30,
    clientEnd: currentYear + 50,
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amountValid) return;
    setSaving(true);
    setError(null);
    try {
      // Build source account note for context (sourceAccountId is UI-only, not in POST body)
      const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
      const sourceNote = sourceAccount ? `Source: ${sourceAccount.name}` : null;
      const combinedNotes = [notes || null, sourceNote].filter(Boolean).join(" | ") || null;

      const body = {
        year,
        yearRef,
        grantor,
        recipientEntityId: trustId,
        amount: amountNum,
        useCrummeyPowers,
        notes: combinedNotes,
        // NO accountId, liabilityId, percent, sourceAccountId
      };

      const res = await fetch(`/api/clients/${clientId}/gifts`, {
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
    <form id="transfer-cash-form" onSubmit={submit} className="flex flex-col gap-4">
      {/* Amount */}
      <div>
        <label htmlFor="cash-amount" className={fieldLabelClassName}>
          Amount
        </label>
        <CurrencyInput
          id="cash-amount"
          value={amount}
          onChange={setAmount}
          placeholder="e.g. 10,000"
        />
      </div>

      {/* Transfer year */}
      <MilestoneYearPicker
        name="giftYear"
        id="gift-year"
        value={year}
        yearRef={yearRef}
        milestones={fallbackMilestones}
        onChange={(yr, ref) => {
          setYear(yr);
          setYearRef(ref);
        }}
        label="Gift year"
      />

      {/* Grantor radio */}
      <div>
        <span id="grantor-label" className={fieldLabelClassName}>
          Grantor
        </span>
        <div
          role="radiogroup"
          aria-labelledby="grantor-label"
          className="mt-1 flex gap-4 text-sm text-ink"
        >
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

      {/* Crummey powers */}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={useCrummeyPowers}
          onChange={(e) => setUseCrummeyPowers(e.target.checked)}
          className="accent-accent"
        />
        Apply Crummey powers (30-day withdrawal right)
      </label>

      {/* Source account — UI only, not sent in POST body */}
      {accounts.length > 0 && (
        <div>
          <label htmlFor="source-account" className={fieldLabelClassName}>
            Source account
          </label>
          <select
            id="source-account"
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value)}
            className={selectClassName}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.isDefaultChecking ? " (default checking)" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-ink-4">
            Informational only — source account is not recorded on the gift record.
          </p>
        </div>
      )}

      {/* Notes */}
      <div>
        <label htmlFor="cash-notes" className={fieldLabelClassName}>
          Notes (optional)
        </label>
        <textarea
          id="cash-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={textareaClassName}
        />
      </div>

      {/* Error */}
      {error && (
        <div role="status" aria-live="polite" className="text-xs text-red-400">
          {error}
        </div>
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
          disabled={saving || !amountValid}
          className="rounded-[var(--radius-sm)] bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
