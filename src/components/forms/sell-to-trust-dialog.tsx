"use client";

// Sell-to-trust dialog: opens from the IDGT trust form's "Notes & sales" tab.
// The advisor picks a family-member-owned account, sets note terms, and submits.
// The /sale-to-trust route creates two scenario_changes (toggleable as one
// bundle via a shared toggleGroupId): an `edit` reassigning the source
// account's owners to the trust, and inserts a new note into notes_receivable
// held by the original family members. See:
//   src/app/api/clients/[id]/scenarios/[sid]/sale-to-trust/route.ts

import { useMemo, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import { PercentInput } from "@/components/percent-input";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";
import type { Entity } from "@/components/family-view";
import type { AssetsTabAccount } from "./assets-tab";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "./input-styles";

type NotePaymentType = "amortizing" | "interest_only_balloon";

/**
 * One sale to the trust, as the dialog's fields describe it. Deliberately just
 * the sale's terms: `clientId` and `scenarioId` stay out because the scenario
 * is exactly what an injected `submit` does not have, and any caller already
 * knows its own client.
 */
export interface SaleToTrustInput {
  accountId: string;
  /**
   * The trust that receives the asset. Carried as its own field — never folded
   * into an opaque body blob — because it is a live hazard for any caller that
   * persists this itself: the route writes it to
   * `notes_receivable.linked_trust_entity_id`, a real foreign key to
   * `entities.id`. A trust that exists only as a pending change has no row in
   * `entities` yet, so a note linked to it violates the FK and fails the whole
   * save.
   */
  trustEntityId: string;
  noteInterestRate: number;
  noteTermMonths: number;
  noteStartYear: number;
  notePaymentType: NotePaymentType;
}

interface Props {
  clientId: string;
  scenarioId: string | null;
  trust: Entity;
  accounts: AssetsTabAccount[];
  /**
   * Persists the sale. Defaults to POSTing the sale-to-trust route, which is
   * what the Estate Planning details page wants. The solver passes its own,
   * emitting a note-receivable-upsert against the working tree instead — in the
   * solver there is no scenario to POST to until the scenario is saved, so an
   * injected submit also stands in for the active-scenario requirement below.
   * Reject to surface the failure on the dialog's error line.
   */
  submit?: (input: SaleToTrustInput) => Promise<void>;
}

const RETIREMENT_SET = new Set<string>(RETIREMENT_SUBTYPES);

/** Today's behaviour: POST the sale to the scenario's sale-to-trust route. */
async function postSaleToTrust(
  clientId: string,
  scenarioId: string,
  input: SaleToTrustInput,
): Promise<void> {
  const res = await fetch(
    `/api/clients/${clientId}/scenarios/${scenarioId}/sale-to-trust`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
}

/**
 * Eligible-source filter: family-member-owned (no entity owners), not the
 * default checking account, and not a retirement account.
 */
function isEligibleSource(a: AssetsTabAccount): boolean {
  if (a.isDefaultChecking) return false;
  if (a.subType && RETIREMENT_SET.has(a.subType)) return false;
  // No entity owners — must be family-member-owned end-to-end.
  if (a.owners.some((o) => o.kind === "entity")) return false;
  // At least one family-member owner to reassign.
  return a.owners.some((o) => o.kind === "family_member");
}

export default function SellToTrustDialog({
  clientId,
  scenarioId,
  trust,
  accounts,
  submit,
}: Props) {
  const [open, setOpen] = useState(false);
  const eligible = useMemo(() => accounts.filter(isEligibleSource), [accounts]);

  const [accountId, setAccountId] = useState<string>("");
  const [interestPct, setInterestPct] = useState("4.0");
  const [termMonths, setTermMonths] = useState("120");
  const [startYear, setStartYear] = useState(String(new Date().getFullYear()));
  const [paymentType, setPaymentType] = useState<NotePaymentType>(
    "interest_only_balloon",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Who persists the sale. An injected submit replaces the POST *and* stands in
  // for the active scenario the POST would need. Null = neither is available,
  // which is the one case the dialog refuses.
  const persist =
    submit ??
    (scenarioId
      ? (input: SaleToTrustInput) =>
          postSaleToTrust(clientId, scenarioId, input)
      : null);

  const canSubmit =
    !!persist &&
    !!accountId &&
    Number(interestPct) > 0 &&
    Number(termMonths) > 0 &&
    Number(startYear) >= 1900;

  function reset() {
    setAccountId("");
    setInterestPct("4.0");
    setTermMonths("120");
    setStartYear(String(new Date().getFullYear()));
    setPaymentType("interest_only_balloon");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!persist) {
      setError("Sales to trust require an active scenario. Open this trust from a scenario view.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await persist({
        accountId,
        trustEntityId: trust.id,
        noteInterestRate: Number(interestPct) / 100,
        noteTermMonths: Number(termMonths),
        noteStartYear: Number(startYear),
        notePaymentType: paymentType,
      });
      reset();
      setOpen(false);
      // Caller (page-level data) refreshes via router events triggered by the
      // route handler; no explicit refresh here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sell to trust");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-ink-3 px-3 py-1.5 text-xs text-ink-2 hover:bg-paper"
      >
        Sell an asset to the trust
      </button>

      {open && (
        <DialogShell
          open
          onOpenChange={(o) => {
            if (!o) {
              reset();
              setOpen(false);
            }
          }}
          title={`Sell to ${trust.name}`}
          size="md"
          primaryAction={{
            label: saving ? "Selling…" : "Sell to trust",
            form: "sell-to-trust-form",
            disabled: !canSubmit || saving,
            loading: saving,
          }}
        >
          <form
            id="sell-to-trust-form"
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
          >
            <p className="text-[12px] text-ink-3">
              Reassigns ownership of an asset to the trust in exchange for a
              promissory note held by the family member(s). The note is created
              automatically with the terms below.
            </p>

            <div>
              <label htmlFor="sell-account" className={fieldLabelClassName}>
                Asset to sell
              </label>
              {eligible.length === 0 ? (
                <p className="text-[12px] italic text-ink-4">
                  No eligible family-owned assets to sell.
                </p>
              ) : (
                <select
                  id="sell-account"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className={selectClassName}
                  required
                >
                  <option value="">— Select an asset —</option>
                  {eligible.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — ${a.value.toLocaleString()}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sell-rate" className={fieldLabelClassName}>
                  Interest rate
                </label>
                <PercentInput
                  id="sell-rate"
                  value={interestPct}
                  onChange={setInterestPct}
                />
              </div>
              <div>
                <label htmlFor="sell-term" className={fieldLabelClassName}>
                  Term (months)
                </label>
                <input
                  id="sell-term"
                  type="number"
                  min={1}
                  step={1}
                  value={termMonths}
                  onChange={(e) => setTermMonths(e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="sell-start-year" className={fieldLabelClassName}>
                  Start year
                </label>
                <input
                  id="sell-start-year"
                  type="number"
                  min={1900}
                  max={2200}
                  step={1}
                  value={startYear}
                  onChange={(e) => setStartYear(e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="sell-payment-type" className={fieldLabelClassName}>
                  Payment type
                </label>
                <select
                  id="sell-payment-type"
                  value={paymentType}
                  onChange={(e) =>
                    setPaymentType(e.target.value as NotePaymentType)
                  }
                  className={selectClassName}
                >
                  <option value="interest_only_balloon">
                    Interest only, balloon
                  </option>
                  <option value="amortizing">Amortizing</option>
                </select>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
          </form>
        </DialogShell>
      )}
    </>
  );
}
