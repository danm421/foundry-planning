"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon, ArrowRightIcon } from "@/components/icons";

interface CrmHouseholdFormProps {
  mode: "create";
}

const STATUS_OPTIONS = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

export function CrmHouseholdForm({ mode }: CrmHouseholdFormProps) {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user?.id) {
      setError("Not signed in.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const notes = String(data.get("notes") ?? "").trim();
    try {
      const res = await fetch("/api/crm/households", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          status: data.get("status"),
          advisorId: user.id,
          notes: notes ? notes : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Create failed (${res.status})`,
        );
      }
      const { household } = await res.json();
      router.push(`/crm/households/${household.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label className={fieldLabelClassName} htmlFor="name">
          Household name
        </label>
        <input id="name" name="name" required maxLength={200} className={inputClassName} />
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

      <div>
        <label className={fieldLabelClassName} htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          maxLength={5000}
          className={textareaClassName}
        />
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
        <Link href="/crm" className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={submitting || !isLoaded}
          className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-deep disabled:opacity-60"
        >
          {submitting ? "Creating…" : mode === "create" ? "Create household" : "Save"}
          <ArrowRightIcon width={14} height={14} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
