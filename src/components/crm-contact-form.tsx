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

type ContactRole = "primary" | "spouse" | "dependent" | "other";

export type CrmContactFormInitial = {
  id?: string;
  role: ContactRole;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  ssnLast4: string | null;
  notes: string | null;
};

const ROLE_OPTIONS: { value: ContactRole; label: string }[] = [
  { value: "primary", label: "Primary" },
  { value: "spouse", label: "Spouse" },
  { value: "dependent", label: "Dependent" },
  { value: "other", label: "Other" },
];

const FORM_ID = "crm-contact-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  existingRoles: Set<"primary" | "spouse">;
  mode: "create" | "edit";
  initialValues?: CrmContactFormInitial;
  onSaved: () => void;
}

export function CrmContactForm({
  open,
  onOpenChange,
  householdId,
  existingRoles,
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

    const body = {
      role: data.get("role") as ContactRole,
      firstName: String(data.get("firstName") ?? "").trim(),
      lastName: String(data.get("lastName") ?? "").trim(),
      preferredName: get("preferredName"),
      dateOfBirth: get("dateOfBirth"),
      email: get("email"),
      phone: get("phone"),
      mobile: get("mobile"),
      addressLine1: get("addressLine1"),
      addressLine2: get("addressLine2"),
      city: get("city"),
      state: get("state"),
      postalCode: get("postalCode"),
      country: get("country"),
      ssnLast4: get("ssnLast4"),
      notes: get("notes"),
    };

    try {
      const url =
        mode === "edit" && initialValues?.id
          ? `/api/crm/households/${householdId}/contacts/${initialValues.id}`
          : `/api/crm/households/${householdId}/contacts`;
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

  // Disable primary/spouse if already taken (unless editing this contact's own role)
  const currentRole = initialValues?.role;
  function isRoleDisabled(role: ContactRole) {
    if (role !== "primary" && role !== "spouse") return false;
    if (currentRole === role) return false;
    return existingRoles.has(role);
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "Edit contact" : "Add contact"}
      size="md"
      primaryAction={{
        label: submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Add contact",
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

        <div>
          <label className={fieldLabelClassName} htmlFor="ct-role">
            Role
          </label>
          <select
            id="ct-role"
            name="role"
            defaultValue={initialValues?.role ?? "primary"}
            className={selectClassName}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                disabled={isRoleDisabled(opt.value)}
              >
                {opt.label}
                {isRoleDisabled(opt.value) ? " (already assigned)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-first">
              First name <span className="text-crit">*</span>
            </label>
            <input
              id="ct-first"
              name="firstName"
              required
              maxLength={100}
              defaultValue={initialValues?.firstName ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-last">
              Last name <span className="text-crit">*</span>
            </label>
            <input
              id="ct-last"
              name="lastName"
              required
              maxLength={100}
              defaultValue={initialValues?.lastName ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-preferred">
              Preferred name
            </label>
            <input
              id="ct-preferred"
              name="preferredName"
              maxLength={100}
              defaultValue={initialValues?.preferredName ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-dob">
              Date of birth
            </label>
            <input
              id="ct-dob"
              name="dateOfBirth"
              type="date"
              defaultValue={initialValues?.dateOfBirth ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-email">
              Email
            </label>
            <input
              id="ct-email"
              name="email"
              type="email"
              defaultValue={initialValues?.email ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-phone">
              Phone
            </label>
            <input
              id="ct-phone"
              name="phone"
              maxLength={40}
              defaultValue={initialValues?.phone ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-mobile">
              Mobile
            </label>
            <input
              id="ct-mobile"
              name="mobile"
              maxLength={40}
              defaultValue={initialValues?.mobile ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ct-ssn4">
              SSN last 4
            </label>
            <input
              id="ct-ssn4"
              name="ssnLast4"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              placeholder="1234"
              defaultValue={initialValues?.ssnLast4 ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <details className="rounded-[var(--radius-sm)] border border-hair bg-card-2 p-3">
          <summary className="cursor-pointer select-none text-[13px] font-medium text-ink-2 hover:text-ink">
            Address
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className={fieldLabelClassName} htmlFor="ct-addr1">
                Address line 1
              </label>
              <input
                id="ct-addr1"
                name="addressLine1"
                maxLength={200}
                defaultValue={initialValues?.addressLine1 ?? ""}
                className={inputClassName}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="ct-addr2">
                Address line 2
              </label>
              <input
                id="ct-addr2"
                name="addressLine2"
                maxLength={200}
                defaultValue={initialValues?.addressLine2 ?? ""}
                className={inputClassName}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabelClassName} htmlFor="ct-city">
                  City
                </label>
                <input
                  id="ct-city"
                  name="city"
                  maxLength={100}
                  defaultValue={initialValues?.city ?? ""}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={fieldLabelClassName} htmlFor="ct-state">
                  State
                </label>
                <input
                  id="ct-state"
                  name="state"
                  maxLength={50}
                  defaultValue={initialValues?.state ?? ""}
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabelClassName} htmlFor="ct-zip">
                  Postal code
                </label>
                <input
                  id="ct-zip"
                  name="postalCode"
                  maxLength={20}
                  defaultValue={initialValues?.postalCode ?? ""}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={fieldLabelClassName} htmlFor="ct-country">
                  Country
                </label>
                <input
                  id="ct-country"
                  name="country"
                  maxLength={100}
                  defaultValue={initialValues?.country ?? ""}
                  className={inputClassName}
                />
              </div>
            </div>
          </div>
        </details>

        <div>
          <label className={fieldLabelClassName} htmlFor="ct-notes">
            Notes
          </label>
          <textarea
            id="ct-notes"
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
