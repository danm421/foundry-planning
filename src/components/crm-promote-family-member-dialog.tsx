"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import { StateSelect } from "@/components/state-select";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";

const STATUS_OPTIONS = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

const FORM_ID = "crm-promote-family-member-form";

export type CrmPromoteFamilyMemberInitial = {
  sourceFamilyMemberId?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
};

// Return type left to inference — no other component in this codebase
// annotates `JSX.Element` explicitly, and React 19's @types/react removed
// the global JSX namespace (only `React.JSX` resolves), so a literal
// `JSX.Element` annotation here doesn't compile.
export function CrmPromoteFamilyMemberDialog(props: {
  sourceHouseholdId: string;
  defaultState: string | null; // parent household's state, prefills the picker
  initial: CrmPromoteFamilyMemberInitial;
  open: boolean;
  onClose: () => void;
}) {
  const { sourceHouseholdId, defaultState, initial, open, onClose } = props;
  const router = useRouter();
  const [state, setState] = useState(defaultState ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!state) {
      setError("Pick the new household's state of residence.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const get = (key: string) => {
      const v = String(data.get(key) ?? "").trim();
      return v ? v : undefined;
    };
    const firstName = String(data.get("firstName") ?? "").trim();
    const lastName = String(data.get("lastName") ?? "").trim();
    const status = String(data.get("status") ?? "prospect");

    try {
      const res = await fetch(
        `/api/crm/households/${sourceHouseholdId}/promote-family-member`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceFamilyMemberId: initial.sourceFamilyMemberId,
            firstName,
            lastName,
            dateOfBirth: get("dateOfBirth"),
            email: get("email"),
            phone: get("phone"),
            mobile: get("mobile"),
            state,
            status,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Promote failed (${res.status})`,
        );
      }
      // { householdId, existing } — existing:true just means it was already
      // promoted; landing on that household is still the right confirmation.
      const json = (await res.json()) as { householdId: string; existing: boolean };
      router.push(`/crm/households/${json.householdId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promote failed");
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Promote to household"
      size="md"
      primaryAction={{
        label: submitting ? "Saving…" : "Promote to household",
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

        <p className="text-[13px] text-ink-2">
          Creates a new household linked to this one. {initial.firstName} also stays in this
          household&rsquo;s planning data.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-firstName">
              First name
            </label>
            <input
              id="promote-firstName"
              name="firstName"
              required
              maxLength={100}
              defaultValue={initial.firstName}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-lastName">
              Last name
            </label>
            <input
              id="promote-lastName"
              name="lastName"
              required
              maxLength={100}
              defaultValue={initial.lastName}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-dob">
              Date of birth
            </label>
            <input
              id="promote-dob"
              name="dateOfBirth"
              type="date"
              defaultValue={initial.dateOfBirth ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-email">
              Email
            </label>
            <input
              id="promote-email"
              name="email"
              type="email"
              defaultValue={initial.email ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-phone">
              Phone
            </label>
            <input
              id="promote-phone"
              name="phone"
              maxLength={40}
              defaultValue={initial.phone ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-mobile">
              Mobile
            </label>
            <input
              id="promote-mobile"
              name="mobile"
              maxLength={40}
              defaultValue={initial.mobile ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-state">
              State of residence
            </label>
            <StateSelect id="promote-state" name="state" value={state} onChange={setState} required />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="promote-status">
              Status
            </label>
            <select
              id="promote-status"
              name="status"
              defaultValue="prospect"
              className={selectClassName}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>
    </DialogShell>
  );
}
