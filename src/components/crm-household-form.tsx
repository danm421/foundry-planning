"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon, ArrowRightIcon } from "@/components/icons";
import { buildHouseholdName } from "@/lib/crm/household-name";

interface CrmHouseholdFormProps {
  mode: "create";
}

// Sanitize `returnTo` so an attacker can't bounce the user to an off-site URL
// by editing the query string. Only allow same-origin absolute paths.
function safeReturnTo(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null; // protocol-relative URL
  return raw;
}

const STATUS_OPTIONS = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

export function CrmHouseholdForm({ mode }: CrmHouseholdFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnTo(searchParams.get("returnTo"));
  const { user, isLoaded } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contacts (primary + optional spouse). Controlled so the household name
  // can derive live from them via buildHouseholdName.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [addSpouse, setAddSpouse] = useState(false);
  const [spouseFirstName, setSpouseFirstName] = useState("");
  const [spouseLastName, setSpouseLastName] = useState("");

  // Household name: auto-derived from the contacts until the advisor edits it.
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    if (nameTouched) return;
    setName(
      buildHouseholdName({
        firstName,
        lastName,
        spouseFirstName: addSpouse ? spouseFirstName : "",
        spouseLastName: addSpouse ? spouseLastName : "",
      }),
    );
  }, [firstName, lastName, addSpouse, spouseFirstName, spouseLastName, nameTouched]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user?.id) {
      setError("Not signed in.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const dob = String(data.get("dob") ?? "").trim();
    const spouseDob = String(data.get("spouseDob") ?? "").trim();

    const contacts: Array<{
      role: "primary" | "spouse";
      firstName: string;
      lastName: string;
      dateOfBirth?: string;
    }> = [
      {
        role: "primary",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(dob ? { dateOfBirth: dob } : {}),
      },
    ];
    if (addSpouse && spouseFirstName.trim()) {
      contacts.push({
        role: "spouse",
        firstName: spouseFirstName.trim(),
        lastName: spouseLastName.trim() || lastName.trim(),
        ...(spouseDob ? { dateOfBirth: spouseDob } : {}),
      });
    }

    try {
      const res = await fetch("/api/crm/households", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          status: data.get("status"),
          advisorId: user.id,
          contacts,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Create failed (${res.status})`,
        );
      }
      const { household } = await res.json();
      if (returnTo) {
        // Bounce back to the caller (e.g. /clients/new) with the new household
        // id so they can resume their flow.
        const sep = returnTo.includes("?") ? "&" : "?";
        router.push(`${returnTo}${sep}crmHouseholdId=${household.id}`);
      } else {
        router.push(`/crm/households/${household.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Client contact */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={fieldLabelClassName} htmlFor="firstName">
            First name
          </label>
          <input
            id="firstName"
            name="firstName"
            required
            maxLength={100}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClassName}
          />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor="lastName">
            Last name
          </label>
          <input
            id="lastName"
            name="lastName"
            required
            maxLength={100}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClassName}
          />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor="dob">
            Date of birth <span className="text-ink-4">(optional)</span>
          </label>
          <input id="dob" name="dob" type="date" min="1910-01-01" className={inputClassName} />
          <p className="mt-1 text-[12px] text-ink-4">Defaults to age 50 if left blank.</p>
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue="prospect" className={selectClassName}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Spouse */}
      <div className="border-t border-hair pt-4">
        <label htmlFor="addSpouse" className="flex items-center gap-2 cursor-pointer">
          <input
            id="addSpouse"
            type="checkbox"
            checked={addSpouse}
            onChange={(e) => setAddSpouse(e.target.checked)}
            className="h-4 w-4 rounded border-hair bg-card-2 text-accent focus:ring-accent"
          />
          <span className="text-[13px] font-medium text-ink-2">Add spouse</span>
        </label>
        {addSpouse && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={fieldLabelClassName} htmlFor="spouseFirstName">
                Spouse first name
              </label>
              <input
                id="spouseFirstName"
                name="spouseFirstName"
                maxLength={100}
                value={spouseFirstName}
                onChange={(e) => setSpouseFirstName(e.target.value)}
                className={inputClassName}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="spouseLastName">
                Spouse last name
              </label>
              <input
                id="spouseLastName"
                name="spouseLastName"
                maxLength={100}
                placeholder="Leave blank to inherit client's"
                value={spouseLastName}
                onChange={(e) => setSpouseLastName(e.target.value)}
                className={inputClassName}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={fieldLabelClassName} htmlFor="spouseDob">
                Spouse date of birth <span className="text-ink-4">(optional)</span>
              </label>
              <input id="spouseDob" name="spouseDob" type="date" min="1910-01-01" className={inputClassName} />
            </div>
          </div>
        )}
      </div>

      {/* Household name — auto, editable */}
      <div className="border-t border-hair pt-4">
        <label className={fieldLabelClassName} htmlFor="name">
          Household name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={200}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(e.target.value !== "");
          }}
          className={inputClassName}
        />
        <p className="mt-1 text-[12px] text-ink-4">
          Auto-generated from the contacts above. Edit to override.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <Link href={returnTo ?? "/crm"} className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={submitting || !isLoaded}
          className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-ink disabled:opacity-60"
        >
          {submitting ? "Creating…" : mode === "create" ? "Create household" : "Save"}
          <ArrowRightIcon width={14} height={14} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
