"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";

export type CrmAccountFormInitial = {
  id?: string;
  contactId: string | null;
  accountType: string | null;
  custodian: string | null;
  accountNumberLast4: string | null;
  balance: string | null;
  balanceAsOf: string | null;
  notes: string | null;
};

export type CrmContactOption = {
  id: string;
  firstName: string;
  lastName: string;
};

const FORM_ID = "crm-account-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  contacts: CrmContactOption[];
  mode: "create" | "edit";
  initialValues?: CrmAccountFormInitial;
  onSaved: () => void;
}

export function CrmAccountForm({
  open,
  onOpenChange,
  householdId,
  contacts,
  mode,
  initialValues,
  onSaved,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);

    const get = (key: string) => {
      const v = String(data.get(key) ?? "").trim();
      return v ? v : undefined;
    };

    const contactIdRaw = String(data.get("contactId") ?? "");
    const balanceRaw = String(data.get("balance") ?? "").trim();
    const balanceNum = balanceRaw === "" ? undefined : Number(balanceRaw);

    const body: Record<string, unknown> = {
      contactId: contactIdRaw === "" ? null : contactIdRaw,
      accountType: get("accountType"),
      custodian: get("custodian"),
      accountNumberLast4: get("accountNumberLast4"),
      balanceAsOf: get("balanceAsOf"),
      notes: get("notes"),
    };
    if (balanceNum !== undefined && Number.isFinite(balanceNum)) {
      body.balance = balanceNum;
    }

    try {
      const url =
        mode === "edit" && initialValues?.id
          ? `/api/crm/households/${householdId}/accounts/${initialValues.id}`
          : `/api/crm/households/${householdId}/accounts`;
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Save failed (${res.status})`,
        );
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "Edit account" : "Add account"}
      size="md"
      primaryAction={{
        label: submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Add account",
        form: FORM_ID,
        loading: submitting,
      }}
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ac-custodian">
              Custodian
            </label>
            <input
              id="ac-custodian"
              name="custodian"
              maxLength={100}
              placeholder="Schwab, Fidelity, …"
              defaultValue={initialValues?.custodian ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ac-type">
              Account type
            </label>
            <input
              id="ac-type"
              name="accountType"
              maxLength={100}
              placeholder="IRA, Roth IRA, Brokerage, …"
              defaultValue={initialValues?.accountType ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ac-last4">
              Account number (last 4)
            </label>
            <input
              id="ac-last4"
              name="accountNumberLast4"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              placeholder="1234"
              defaultValue={initialValues?.accountNumberLast4 ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ac-owner">
              Owner
            </label>
            <select
              id="ac-owner"
              name="contactId"
              defaultValue={initialValues?.contactId ?? ""}
              className={selectClassName}
            >
              <option value="">Joint / Household</option>
              {contacts.map((c) => {
                const label = `${c.firstName} ${c.lastName}`.replace(/\s+/g, " ").trim() || "—";
                return (
                  <option key={c.id} value={c.id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ac-balance">
              Balance
            </label>
            <input
              id="ac-balance"
              name="balance"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="0.00"
              defaultValue={initialValues?.balance ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ac-as-of">
              Balance as of
            </label>
            <input
              id="ac-as-of"
              name="balanceAsOf"
              type="date"
              defaultValue={initialValues?.balanceAsOf ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="ac-notes">
            Notes
          </label>
          <textarea
            id="ac-notes"
            name="notes"
            rows={3}
            maxLength={5000}
            defaultValue={initialValues?.notes ?? ""}
            className={textareaClassName}
          />
        </div>
      </form>
    </DialogShell>
  );
}
