"use client";

import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import { AlertCircleIcon } from "@/components/icons";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { validatePrimaryColor } from "@/lib/branding/validation";
// Generic email-shape regex, already the established client-mirrors-server
// pattern for form validation (see send-client-form.tsx / send-prospect-form.tsx).
import { EMAIL_RE } from "@/lib/intake/schema";
import {
  uploadAdvisorBrandingAsset,
  removeAdvisorBrandingAsset,
} from "./advisor-actions";
import { AssetCard, toFileFormData } from "./brand-cards";

type Initial = {
  brandName: string | null;
  primaryColor: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  address: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
};

const FIELD_KEYS = [
  "brandName",
  "primaryColor",
  "contactEmail",
  "contactPhone",
  "website",
  "address",
  "emailFromName",
  "emailReplyTo",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];
type FieldValues = Record<FieldKey, string>;

function isValidEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

function isValidHttpUrl(v: string): boolean {
  if (v.length > 2048) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Mirrors the server's `brandFieldsSchema` (see `route.ts`) so a save
 *  rarely round-trips just to discover a 400. The server remains
 *  authoritative — `handleSave` also maps its `fieldErrors` onto the form. */
function validateField(key: FieldKey, value: string): string | null {
  // Blank OR whitespace-only clears the field on save — always valid. Mirrors
  // the server's `emptyToNull`/`trimToNull` preprocessors (route.ts:20-35),
  // which treat an all-whitespace value as "not set" too; the client must
  // not be stricter than the server it's mirroring.
  if (value.trim() === "") return null;
  switch (key) {
    case "brandName":
    case "emailFromName":
      return value.length <= 120 ? null : "Must be 120 characters or fewer";
    case "primaryColor": {
      const check = validatePrimaryColor(value);
      return check.ok ? null : check.error;
    }
    case "contactEmail":
    case "emailReplyTo":
      return isValidEmail(value) ? null : "Enter a valid email address";
    case "contactPhone":
      return value.length <= 40 ? null : "Must be 40 characters or fewer";
    case "website":
      return isValidHttpUrl(value) ? null : "Enter a valid http(s) URL";
    case "address":
      return value.length <= 500 ? null : "Must be 500 characters or fewer";
  }
}

function toFieldValues(initial: Initial): FieldValues {
  return Object.fromEntries(
    FIELD_KEYS.map((key) => [key, initial[key] ?? ""]),
  ) as FieldValues;
}

export default function AdvisorBrandForm({
  initial,
  brandingEnabled,
  canEdit,
  advisorUserId,
}: {
  initial: Initial;
  brandingEnabled: boolean;
  canEdit: boolean;
  advisorUserId?: string;
}) {
  const [fields, setFields] = useState<FieldValues>(() => toFieldValues(initial));
  const [saved, setSaved] = useState<FieldValues>(() => toFieldValues(initial));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const dirty = FIELD_KEYS.some((key) => fields[key] !== saved[key]);

  if (!canEdit) {
    return (
      <p className="rounded border border-hair bg-card-2 px-3 py-2.5 text-sm text-ink-3">
        Your firm hasn&apos;t enabled custom branding.
      </p>
    );
  }

  function setField(key: FieldKey, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    // A field the user is actively correcting shouldn't keep showing a
    // stale red border until the next Save round-trip.
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function handleSave() {
    // Only the keys that actually changed since the last successful save —
    // never all eight. `upsertAdvisorProfile` builds `set: { ...payload }`
    // (advisor-profile.ts), so an omitted key leaves that column alone, and
    // the route's audit metadata (`fieldsChanged: Object.keys(parsed.data)`)
    // stays a real signal instead of a constant list of all eight fields.
    // A cleared field is still dirty, so it still travels as "".
    const dirtyKeys = FIELD_KEYS.filter((key) => fields[key] !== saved[key]);
    if (dirtyKeys.length === 0) return; // Save is disabled for this state; this is belt-and-suspenders against a stray form submit.

    const nextErrors: Partial<Record<FieldKey, string>> = {};
    for (const key of dirtyKeys) {
      const err = validateField(key, fields[key]);
      if (err) nextErrors[key] = err;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setToast("Couldn't save — check the highlighted fields");
      return;
    }
    setErrors({});

    const payload: Partial<FieldValues> = {};
    for (const key of dirtyKeys) payload[key] = fields[key];

    const qs = advisorUserId ? `?advisorUserId=${encodeURIComponent(advisorUserId)}` : "";
    startTransition(async () => {
      let res: Response;
      try {
        res = await fetch(`/api/advisor-branding${qs}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        setToast("Couldn't save. Check your connection and try again.");
        return;
      }

      if (!res.ok) {
        if (res.status === 400) {
          const body = await res.json().catch(() => null);
          const fieldErrors = (body?.error?.fieldErrors ?? {}) as Record<
            string,
            string[] | undefined
          >;
          const mapped: Partial<Record<FieldKey, string>> = {};
          for (const key of FIELD_KEYS) {
            const msgs = fieldErrors[key];
            if (msgs?.length) mapped[key] = msgs[0];
          }
          if (Object.keys(mapped).length > 0) {
            setErrors(mapped);
            setToast("Couldn't save — check the highlighted fields");
          } else {
            // No per-field issues to highlight (e.g. a `formErrors`-only
            // 400) — don't tell the user to look at fields that aren't
            // marked.
            setToast("Couldn't save. Please try again.");
          }
        } else if (res.status === 403) {
          setToast("You don't have permission to edit this branding.");
        } else {
          setToast("Couldn't save. Please try again.");
        }
        return;
      }

      setSaved(fields);
      setToast("Saved");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {!brandingEnabled ? (
        <div className="flex items-start gap-2 rounded border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-ink">
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <span>
            Your branding grant is off. You can set these up now, but clients won&apos;t see
            them until it&apos;s enabled.
          </span>
        </div>
      ) : null}

      <AssetCard
        label="Logo"
        helper="PNG, JPEG, or WebP. Up to 2 MB."
        accept="image/png,image/jpeg,image/webp"
        initialUrl={initial.logoUrl}
        previewClass="h-16 w-auto max-w-[240px] object-contain"
        onUpload={(file) =>
          uploadAdvisorBrandingAsset("logo", toFileFormData(file), advisorUserId)
        }
        onRemove={() => removeAdvisorBrandingAsset("logo", advisorUserId)}
      />
      <AssetCard
        label="Favicon"
        helper="PNG. Up to 256 KB. Square (e.g. 32×32 or 64×64) recommended."
        accept="image/png"
        initialUrl={initial.faviconUrl}
        previewClass="h-8 w-8 object-contain"
        onUpload={(file) =>
          uploadAdvisorBrandingAsset("favicon", toFileFormData(file), advisorUserId)
        }
        onRemove={() => removeAdvisorBrandingAsset("favicon", advisorUserId)}
      />

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <section className="flex flex-col gap-4 rounded border border-hair p-4">
          <h3 className="text-sm font-medium text-ink">Brand details</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Brand name"
              value={fields.brandName}
              onChange={(v) => setField("brandName", v)}
              error={errors.brandName}
              maxLength={120}
            />
            <TextField
              label="Primary color"
              value={fields.primaryColor}
              onChange={(v) => setField("primaryColor", v)}
              error={errors.primaryColor}
              maxLength={7}
              // eslint-disable-next-line brand/no-raw-hex -- instructional UI: placeholder shows the expected hex format to the user
              placeholder="#0a2bff"
              swatch={validatePrimaryColor(fields.primaryColor).ok ? fields.primaryColor : null}
            />
            <TextField
              label="Contact email"
              type="email"
              value={fields.contactEmail}
              onChange={(v) => setField("contactEmail", v)}
              error={errors.contactEmail}
              maxLength={254}
            />
            <TextField
              label="Contact phone"
              type="tel"
              value={fields.contactPhone}
              onChange={(v) => setField("contactPhone", v)}
              error={errors.contactPhone}
              maxLength={40}
            />
            <TextField
              label="Website"
              type="url"
              value={fields.website}
              onChange={(v) => setField("website", v)}
              error={errors.website}
              maxLength={2048}
              placeholder="https://example.com"
            />
            <TextField
              label="Address"
              value={fields.address}
              onChange={(v) => setField("address", v)}
              error={errors.address}
              maxLength={500}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded border border-hair p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-ink">
            Intake invitation emails
            <FieldTooltip text="Applies to intake-form invitation emails only. Portal sign-in invitations are sent by our authentication provider and aren't brandable yet." />
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="From name"
              value={fields.emailFromName}
              onChange={(v) => setField("emailFromName", v)}
              error={errors.emailFromName}
              maxLength={120}
            />
            <TextField
              label="Reply-to email"
              type="email"
              value={fields.emailReplyTo}
              onChange={(v) => setField("emailReplyTo", v)}
              error={errors.emailReplyTo}
              maxLength={254}
            />
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || pending}
            className="rounded bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {toast ? <span className="text-sm text-ink-3">{toast}</span> : null}
        </div>
      </form>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  maxLength,
  placeholder,
  type = "text",
  swatch,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  maxLength?: number;
  placeholder?: string;
  type?: string;
  swatch?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink">{label}</span>
      <div className="flex items-center gap-2">
        {swatch !== undefined ? (
          <span
            className="inline-block h-8 w-8 shrink-0 rounded border border-hair"
            style={{ backgroundColor: swatch ?? "transparent" }}
            aria-hidden
          />
        ) : null}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          className={`w-full rounded border bg-paper px-3 py-2 text-ink ${
            error ? "border-crit" : "border-hair"
          }`}
        />
      </div>
      {error ? <span className="text-xs text-crit">{error}</span> : null}
    </label>
  );
}
