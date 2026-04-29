"use client";

import { useState, useMemo } from "react";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import type { ClientMilestones, YearRef } from "@/lib/milestones";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "./input-styles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccountOption {
  id: string;
  name: string;
  value: number;
  growthRate: number;
  subType: string;
  isDefaultChecking: boolean;
  /** Human-readable ownership summary, e.g. "Client 100%" or "Joint 50/50". */
  ownerSummary: string;
  /** Current % owned by THIS trust (0–1). Accounts at 1.0 are filtered out. */
  trustPercent: number;
  /** True when this account is pinned to a different entity (LLC, etc.). */
  ownedByOtherEntity: boolean;
  linkedLiability?: { id: string; name: string; balance: number };
}

interface Props {
  trustId: string;
  /** clientId is required for the POST URL /api/clients/[id]/gifts */
  clientId: string;
  trustGrantor: "client" | "spouse";
  accounts: AccountOption[];
  milestones?: ClientMilestones;
  /**
   * Kept for API compatibility with callers — no longer used internally now that
   * the past-dated amount auto-fill branch has been removed (the route forces
   * amount=null for asset transfers regardless).
   */
  projectionStartYear: number;
  /** Current calendar year — passed as a prop so tests can control it. */
  currentYear: number;
  onClose: () => void;
  onSaved: () => void;
}

/** Fields sent in the POST body. Matches giftCreateSchema's asset-transfer path. */
interface GiftPostBody {
  year: number;
  yearRef: YearRef | null;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId: string;
  accountId: string;
  percent: number;
  notes: string | null;
  amount?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETIREMENT_SUBTYPES_SET = new Set<string>(RETIREMENT_SUBTYPES);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TransferAssetForm({
  trustId,
  clientId,
  trustGrantor,
  accounts,
  milestones,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  projectionStartYear,
  currentYear,
  onClose,
  onSaved,
}: Props) {
  const eligibleAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          !RETIREMENT_SUBTYPES_SET.has(a.subType) &&
          !a.isDefaultChecking &&
          a.trustPercent < 1 &&
          !a.ownedByOtherEntity,
      ),
    [accounts],
  );

  const [accountId, setAccountId] = useState<string>(
    eligibleAccounts[0]?.id ?? "",
  );
  const account = eligibleAccounts.find((a) => a.id === accountId);

  const [percent, setPercent] = useState("50");
  const [year, setYear] = useState(currentYear + 5);
  const [yearRef, setYearRef] = useState<YearRef | null>(null);
  const [grantor, setGrantor] = useState<"client" | "spouse">(trustGrantor);
  const [overrideAmount, setOverrideAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const estimatedValue = useMemo(() => {
    if (!account) return 0;
    const yearsForward = Math.max(0, year - currentYear);
    return (
      account.value *
      Math.pow(1 + account.growthRate, yearsForward) *
      (Number(percent) / 100)
    );
  }, [account, year, percent, currentYear]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    setSaving(true);
    setError(null);
    try {
      const body: GiftPostBody = {
        year,
        yearRef,
        grantor,
        recipientEntityId: trustId,
        accountId: account.id,
        percent: Number(percent) / 100,
        notes: notes || null,
      };

      // NOTE: The API route forces amount=null for asset transfers (accountId set).
      // overrideAmount is reserved for future valuation-discount support (FLP, minority interest)
      // and currently has no effect. Tracked in future-work/ui.md (2026-04-28).
      if (overrideAmount) {
        body.amount = Number(overrideAmount);
      }

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

  function balanceRemaining() {
    // Simple version: claim 100% (transfers entire remaining household stake to trust).
    // Multi-owner remainder distribution is future work.
    setPercent("100");
  }

  const fallbackMilestones: ClientMilestones = milestones ?? {
    planStart: currentYear,
    planEnd: currentYear + 50,
    clientRetirement: currentYear + 30,
    clientEnd: currentYear + 50,
  };

  const percentNum = Number(percent);
  const percentValid = Number.isFinite(percentNum) && percentNum > 0 && percentNum <= 100;

  return (
    <form id="transfer-asset-form" onSubmit={submit} className="flex flex-col gap-4">
      {/* Asset selector */}
      <div>
        {eligibleAccounts.length === 0 ? (
          <div className="text-xs text-gray-400 italic">
            No eligible assets to transfer. (Excludes retirement, default-checking,
            100%-trust-owned, and other-entity-pinned accounts.)
          </div>
        ) : (
          <>
            <label htmlFor="transfer-account" className={fieldLabelClassName}>
              Asset
            </label>
            <select
              id="transfer-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className={selectClassName}
            >
              {eligibleAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.ownerSummary} — ${a.value.toLocaleString()}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* Linked liability warning */}
      {account?.linkedLiability && (
        <div
          role="status"
          aria-live="polite"
          className="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-300"
        >
          Linked liability detected:{" "}
          <strong>{account.linkedLiability.name}</strong> ($
          {account.linkedLiability.balance.toLocaleString()}) — will
          auto-bundle
        </div>
      )}

      {/* Percent + balance button */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="transfer-percent" className={fieldLabelClassName}>
            Percent to transfer
          </label>
          <PercentInput
            id="transfer-percent"
            value={percent}
            onChange={setPercent}
          />
        </div>
        <button
          type="button"
          onClick={balanceRemaining}
          className="mb-0.5 text-xs text-ink-3 underline hover:text-ink"
        >
          Balance remaining
        </button>
      </div>

      {/* Transfer year */}
      <MilestoneYearPicker
        name="transferYear"
        id="transfer-year"
        value={year}
        yearRef={yearRef}
        milestones={fallbackMilestones}
        onChange={(yr, ref) => {
          setYear(yr);
          setYearRef(ref);
        }}
        label="Transfer year"
      />

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

      {/* Estimated value preview */}
      <div className="text-xs text-ink-3">
        Estimated value at transfer year:{" "}
        <span className="font-medium text-ink-2">
          ${estimatedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>

      {/* Override amount */}
      <div>
        <label htmlFor="transfer-amount" className={fieldLabelClassName}>
          Override amount (optional)
        </label>
        <CurrencyInput
          id="transfer-amount"
          value={overrideAmount}
          onChange={setOverrideAmount}
          placeholder="e.g. 80,000"
          disabled
          title="Reserved for future valuation-discount support — currently has no effect on asset transfers."
        />
        <p className="mt-1 text-[10px] text-ink-4">
          Reserved for future valuation-discount support — currently has no effect on asset transfers.
        </p>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="transfer-notes" className={fieldLabelClassName}>
          Notes (optional)
        </label>
        <textarea
          id="transfer-notes"
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
          disabled={saving || !account || !percentValid}
          className="rounded-[var(--radius-sm)] bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
