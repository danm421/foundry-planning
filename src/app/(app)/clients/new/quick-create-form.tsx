"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import { ArrowRightIcon, AlertCircleIcon } from "@/components/icons";

export default function QuickCreateForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: data.get("firstName"),
          lastName: data.get("lastName"),
          dateOfBirth: data.get("dateOfBirth"),
          // Sensible defaults — advisor confirms/edits on the Household step.
          retirementAge: 65,
          lifeExpectancy: 95,
          filingStatus: "single",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Create failed (${res.status})`);
      }
      const created = await res.json();
      router.push(`/clients/${created.id}/onboarding/household`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={fieldLabelClassName} htmlFor="firstName">
            First name
          </label>
          <input id="firstName" name="firstName" required autoComplete="given-name" className={inputClassName} />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor="lastName">
            Last name
          </label>
          <input id="lastName" name="lastName" required autoComplete="family-name" className={inputClassName} />
        </div>
      </div>
      <div>
        <label className={fieldLabelClassName} htmlFor="dateOfBirth">
          Date of birth
        </label>
        <input id="dateOfBirth" name="dateOfBirth" type="date" required className={inputClassName} />
        <p className="mt-1.5 text-[12px] text-ink-4">
          Drives age, retirement, and Social Security calculations.
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
        <Link href="/clients" className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-deep disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Start guided setup"}
          <ArrowRightIcon width={14} height={14} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
