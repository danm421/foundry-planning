"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";

export type ExternalContactFormInitial = {
  id?: string;
  firstName: string;
  lastName: string;
  relationshipLabel: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
};

const FORM_ID = "crm-external-contact-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  mode: "create" | "edit";
  initialValues?: ExternalContactFormInitial;
  onSaved: () => void;
}

export function CrmExternalContactForm({
  open,
  onOpenChange,
  householdId,
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

    // Role is fixed: this dialog only ever writes external contacts. The
    // Family column (crm-family-member-form) owns every other role.
    const body = {
      role: "other" as const,
      firstName: String(data.get("firstName") ?? "").trim(),
      lastName: String(data.get("lastName") ?? "").trim(),
      relationshipLabel: get("relationshipLabel"),
      email: get("email"),
      phone: get("phone"),
      mobile: get("mobile"),
      addressLine1: get("addressLine1"),
      addressLine2: get("addressLine2"),
      city: get("city"),
      state: get("state"),
      postalCode: get("postalCode"),
      country: get("country"),
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

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "Edit external contact" : "Add external contact"}
      size="md"
      primaryAction={{
        label: submitting
          ? "Saving…"
          : mode === "edit"
            ? "Save changes"
            : "Add external contact",
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
            <label className={fieldLabelClassName} htmlFor="ec-first">
              First name <span className="text-crit">*</span>
            </label>
            <input
              id="ec-first"
              name="firstName"
              required
              maxLength={100}
              defaultValue={initialValues?.firstName ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            {/* Every save here writes a crm_household_contacts row, and
                createCrmContactSchema.lastName is min(1) — so last name is
                unconditionally required (unlike the family form, where a
                member can exist with no contact row). */}
            <label className={fieldLabelClassName} htmlFor="ec-last">
              Last name <span className="text-crit">*</span>
            </label>
            <input
              id="ec-last"
              name="lastName"
              required
              maxLength={100}
              defaultValue={initialValues?.lastName ?? ""}
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="ec-relationship">
            Relationship
          </label>
          <input
            id="ec-relationship"
            name="relationshipLabel"
            maxLength={100}
            placeholder="CPA, attorney, emergency contact…"
            defaultValue={initialValues?.relationshipLabel ?? ""}
            className={inputClassName}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="ec-email">
            Email
          </label>
          <input
            id="ec-email"
            name="email"
            type="email"
            defaultValue={initialValues?.email ?? ""}
            className={inputClassName}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ec-phone">
              Phone
            </label>
            <input
              id="ec-phone"
              name="phone"
              maxLength={40}
              defaultValue={initialValues?.phone ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ec-mobile">
              Mobile
            </label>
            <input
              id="ec-mobile"
              name="mobile"
              maxLength={40}
              defaultValue={initialValues?.mobile ?? ""}
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
              <label className={fieldLabelClassName} htmlFor="ec-addr1">
                Address line 1
              </label>
              <input
                id="ec-addr1"
                name="addressLine1"
                maxLength={200}
                defaultValue={initialValues?.addressLine1 ?? ""}
                className={inputClassName}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="ec-addr2">
                Address line 2
              </label>
              <input
                id="ec-addr2"
                name="addressLine2"
                maxLength={200}
                defaultValue={initialValues?.addressLine2 ?? ""}
                className={inputClassName}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabelClassName} htmlFor="ec-city">
                  City
                </label>
                <input
                  id="ec-city"
                  name="city"
                  maxLength={100}
                  defaultValue={initialValues?.city ?? ""}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={fieldLabelClassName} htmlFor="ec-state">
                  State
                </label>
                <input
                  id="ec-state"
                  name="state"
                  maxLength={50}
                  defaultValue={initialValues?.state ?? ""}
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabelClassName} htmlFor="ec-zip">
                  Postal code
                </label>
                <input
                  id="ec-zip"
                  name="postalCode"
                  maxLength={20}
                  defaultValue={initialValues?.postalCode ?? ""}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className={fieldLabelClassName} htmlFor="ec-country">
                  Country
                </label>
                <input
                  id="ec-country"
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
          <label className={fieldLabelClassName} htmlFor="ec-notes">
            Notes
          </label>
          <textarea
            id="ec-notes"
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
