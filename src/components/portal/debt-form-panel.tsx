"use client";

import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import { CurrencyInput } from "@/components/portal/currency-input";
import type { PortalDebtRow } from "@/lib/portal/contracts";
import { TYPE_LABEL, TYPE_ORDER } from "@/lib/portal/account-rail";
import { payoffYear, resolveLoanDetails, supportsLoanDetails } from "@/lib/portal/loan-details";

interface FamilyMember {
  id: string;
  firstName: string;
  lastName: string | null;
  role: string;
}

interface TrustEntity {
  id: string;
  name: string;
}

export type DebtFormState = {
  name: string;
  liabilityType: string;
  balance: string;
  /** What the client types: a PERCENT ("6.49"), not the stored fraction. */
  interestRatePct: string;
  monthlyPayment: string;
  ownerFmIds: Set<string>;
  ownerEntityIds: Set<string>;
};

export function emptyDebtForm(defaultFm: string | null = null): DebtFormState {
  return {
    name: "",
    liabilityType: "mortgage",
    balance: "0",
    interestRatePct: "",
    monthlyPayment: "",
    ownerFmIds: new Set(defaultFm ? [defaultFm] : []),
    ownerEntityIds: new Set(),
  };
}

export function debtRowToForm(row: PortalDebtRow): DebtFormState {
  return {
    name: row.name,
    liabilityType: row.liabilityType ?? "other",
    balance: String(row.rawBalance),
    // Stored as a fraction, shown as a percent. Both are null together, so an
    // untouched debt opens with both boxes empty rather than a phantom 0%.
    interestRatePct: row.interestRate == null ? "" : String(round4(row.interestRate * 100)),
    monthlyPayment: row.monthlyPayment == null ? "" : String(row.monthlyPayment),
    ownerFmIds: new Set(row.ownerFmIds),
    ownerEntityIds: new Set(row.ownerEntityIds),
  };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * The rate/payment half of the request body. A type the engine holds flat
 * (credit card) sends explicit nulls so switching a loan to a card clears
 * terms that would otherwise sit stored and ignored.
 *
 * The rate is typed as a PERCENT and stored as a FRACTION, so it is converted
 * here — but an unparseable one is forwarded VERBATIM rather than as NaN.
 * `JSON.stringify(NaN)` is `null`, which the API reads as "no rate given" and
 * would quietly store 0%; the raw string trips its "Enter the interest rate as
 * a number." guard instead. Never destroy a distinction the server exists to
 * catch just because the button that would have blocked it is disabled.
 */
export function debtLoanFieldsFromForm(
  form: DebtFormState,
): { interestRate: number | string | null; monthlyPayment: string | null } {
  if (!supportsLoanDetails(form.liabilityType) || form.monthlyPayment.trim() === "") {
    return { interestRate: null, monthlyPayment: null };
  }
  const pct = Number(form.interestRatePct);
  const blank = form.interestRatePct.trim() === "";
  return {
    interestRate: blank ? 0 : Number.isFinite(pct) ? pct / 100 : form.interestRatePct,
    monthlyPayment: form.monthlyPayment,
  };
}



export function debtOwnersFromForm(
  form: DebtFormState,
): Array<{ kind: "family_member" | "entity"; familyMemberId?: string; entityId?: string; percent: number }> {
  const ids = [
    ...Array.from(form.ownerFmIds).map((id) => ({ kind: "family_member" as const, familyMemberId: id })),
    ...Array.from(form.ownerEntityIds).map((id) => ({ kind: "entity" as const, entityId: id })),
  ];
  if (ids.length === 0) return [];
  const share = 1 / ids.length;
  return ids.map((o) => ({ ...o, percent: share }));
}

export function DebtFormPanel({
  form,
  setForm,
  familyMembers,
  trustEntities,
  onCancel,
  onSubmit,
  disabled,
  plaidLocked,
}: {
  form: DebtFormState;
  setForm: (f: DebtFormState) => void;
  familyMembers: FamilyMember[];
  trustEntities: TrustEntity[];
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
  plaidLocked: boolean;
}): ReactElement {
  const eligibleOwners = familyMembers.filter((m) => m.role === "client" || m.role === "spouse");
  const showLoanTerms = supportsLoanDetails(form.liabilityType);

  // Same validator the API runs, so the preview and the save agree by
  // construction — a payoff date here means the save will not be rejected.
  const loanFields = debtLoanFieldsFromForm(form);
  const loanPreview =
    showLoanTerms && form.monthlyPayment.trim() !== ""
      ? resolveLoanDetails(Number(form.balance), form.liabilityType, loanFields)
      : null;
  // Same start the API will store (January of this year), so the preview names
  // the year the saved plan will actually show.
  const payoff = loanPreview?.ok
    ? payoffYear(new Date().getFullYear(), loanPreview.columns.termMonths)
    : null;

  function toggleFm(id: string) {
    const next = new Set(form.ownerFmIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm({ ...form, ownerFmIds: next });
  }
  function toggleEnt(id: string) {
    const next = new Set(form.ownerEntityIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setForm({ ...form, ownerEntityIds: next });
  }

  return (
    <div className="space-y-3 rounded-md border border-hair bg-card-2 p-4 text-[13px]">
      {plaidLocked && (
        <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-ink-2">
          The balance syncs from your institution and can&apos;t be edited here.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Type</span>
          <select
            value={form.liabilityType}
            onChange={(e) => setForm({ ...form, liabilityType: e.target.value })}
            className="rounded-md border border-hair bg-paper px-2 py-1"
          >
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink-3">Balance</span>
          {plaidLocked ? (
            <span className="rounded-md border border-hair bg-card px-2 py-1 tabular-nums text-ink-3">
              {fmtUsd(Number(form.balance))}
              <span className="ml-1 text-[11px]">· Synced via Plaid</span>
            </span>
          ) : (
            <CurrencyInput
              aria-label="Balance"
              value={form.balance}
              onValueChange={(v) => setForm({ ...form, balance: v })}
              className="rounded-md border border-hair bg-paper px-2 py-1"
            />
          )}
        </label>
      </div>

      {showLoanTerms && (
        <fieldset className="space-y-2">
          <legend className="text-[12px] text-ink-3">Payment terms</legend>
          <p className="text-[12px] text-ink-3">
            Add your rate and monthly payment and your plan will show this loan being
            paid off over time. Your bank doesn&apos;t share these, so copy them from a
            statement. Leave them blank if you&apos;re not sure.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-3">Interest rate (%)</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label="Interest rate"
                placeholder="6.49"
                value={form.interestRatePct}
                onChange={(e) => setForm({ ...form, interestRatePct: e.target.value })}
                className="rounded-md border border-hair bg-paper px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-3">Monthly payment</span>
              <CurrencyInput
                aria-label="Monthly payment"
                value={form.monthlyPayment}
                onValueChange={(v) => setForm({ ...form, monthlyPayment: v })}
                className="rounded-md border border-hair bg-paper px-2 py-1"
              />
            </label>
          </div>
          {payoff && (
            <p className="text-[12px] text-ink-2">
              Paid off in <span className="font-medium text-ink">{payoff}</span>.
            </p>
          )}
          {loanPreview && !loanPreview.ok && (
            <p role="alert" className="text-[12px] text-crit">
              {loanPreview.error}
            </p>
          )}
        </fieldset>
      )}

      <fieldset className="space-y-1">
        <legend className="text-[12px] text-ink-3">Owners</legend>
        {eligibleOwners.length === 0 && trustEntities.length === 0 && (
          <p className="text-[12px] text-ink-3">No owner candidates — ask your advisor to set up your household.</p>
        )}
        {eligibleOwners.map((m) => (
          <label key={m.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.ownerFmIds.has(m.id)}
              onChange={() => toggleFm(m.id)}
            />
            {m.firstName}{m.lastName ? " " + m.lastName : ""}{" "}
            <span className="text-[12px] text-ink-3">({m.role})</span>
          </label>
        ))}
        {trustEntities.map((t) => (
          <label key={t.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.ownerEntityIds.has(t.id)}
              onChange={() => toggleEnt(t.id)}
            />
            {t.name} <span className="text-[12px] text-ink-3">(trust)</span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || (loanPreview != null && !loanPreview.ok)}
          className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent disabled:opacity-50"
        >
          {disabled ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
