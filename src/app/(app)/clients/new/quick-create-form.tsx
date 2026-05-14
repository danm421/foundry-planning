"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";

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
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className={fieldLabelClassName} htmlFor="firstName">First name</label>
        <input id="firstName" name="firstName" required className={inputClassName} />
      </div>
      <div>
        <label className={fieldLabelClassName} htmlFor="lastName">Last name</label>
        <input id="lastName" name="lastName" required className={inputClassName} />
      </div>
      <div>
        <label className={fieldLabelClassName} htmlFor="dateOfBirth">Date of birth</label>
        <input id="dateOfBirth" name="dateOfBirth" type="date" required className={inputClassName} />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Start guided setup →"}
      </button>
    </form>
  );
}
