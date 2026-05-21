"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { ArrowRightIcon, AlertCircleIcon, CheckCircleIcon } from "@/components/icons";
import { CrmHouseholdPicker } from "@/components/crm-household-picker";

/**
 * Two-step new-client flow:
 *   1. Pick (or create) a CRM household. Identity (name/DOB/email/address)
 *      lives in the CRM now — planning never re-collects it.
 *   2. Fill in planning-only fields (retirement, life expectancy, filing
 *      status, spouse retirement params).
 *
 * The selected household id can also arrive via `?crmHouseholdId=...` when
 * the user round-trips through /crm/new. That mirror keeps the flow safe to
 * deep-link from the CRM side.
 */

type FilingStatus =
  | "single"
  | "married_joint"
  | "married_separate"
  | "head_of_household";

const FILING_STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_joint", label: "Married Filing Jointly" },
  { value: "married_separate", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
];

const MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

interface PreviewContact {
  role: "primary" | "spouse" | "dependent" | "other";
  firstName: string;
  lastName: string;
}

interface PreviewHousehold {
  id: string;
  name: string;
  contacts: PreviewContact[];
}

export default function QuickCreateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryHouseholdId = searchParams.get("crmHouseholdId");
  const [householdId, setHouseholdId] = useState<string | null>(queryHouseholdId);
  const [preview, setPreview] = useState<PreviewHousehold | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showSpouse, setShowSpouse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep state in sync with the URL (so a returnTo bounce from /crm/new
  // pre-selects the freshly created household).
  useEffect(() => {
    if (queryHouseholdId && queryHouseholdId !== householdId) {
      setHouseholdId(queryHouseholdId);
    }
  }, [queryHouseholdId, householdId]);

  // Fetch a lightweight preview so step 2 shows which household we're
  // attached to + whether to default the spouse-fields visibility on.
  useEffect(() => {
    if (!householdId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setPreviewError(null);
      try {
        const res = await fetch(`/api/crm/households/${householdId}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const json = (await res.json()) as { household: PreviewHousehold };
        if (cancelled) return;
        setPreview(json.household);
        const hasSpouse = json.household.contacts.some((c) => c.role === "spouse");
        setShowSpouse(hasSpouse);
      } catch (err) {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err.message : "Load failed");
        setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [householdId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!householdId) {
      setError("Pick a CRM household first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      crmHouseholdId: householdId,
      retirementAge: Number(data.get("retirementAge")),
      retirementMonth: Number(data.get("retirementMonth") ?? 1),
      lifeExpectancy: Number(data.get("lifeExpectancy")),
      filingStatus: data.get("filingStatus") as FilingStatus,
    };
    if (showSpouse) {
      const spouseRA = data.get("spouseRetirementAge") as string;
      const spouseRM = data.get("spouseRetirementMonth") as string;
      const spouseLE = data.get("spouseLifeExpectancy") as string;
      if (spouseRA) payload.spouseRetirementAge = Number(spouseRA);
      if (spouseRM) payload.spouseRetirementMonth = Number(spouseRM);
      if (spouseLE) payload.spouseLifeExpectancy = Number(spouseLE);
    }
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Create failed (${res.status})`,
        );
      }
      const created = await res.json();
      router.push(`/clients/${created.id}/onboarding/household`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  // Step 1: pick a household.
  if (!householdId) {
    return (
      <div className="space-y-5">
        <CrmHouseholdPicker
          onSelect={setHouseholdId}
          returnTo="/clients/new"
        />
        <div className="flex items-center justify-between gap-3 pt-1">
          <Link href="/clients" className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
            Cancel
          </Link>
        </div>
      </div>
    );
  }

  const primary = preview?.contacts.find((c) => c.role === "primary");
  const spouse = preview?.contacts.find((c) => c.role === "spouse");
  const householdLabel =
    primary && spouse
      ? `${primary.firstName} & ${spouse.firstName} ${primary.lastName}`
      : primary
        ? `${primary.firstName} ${primary.lastName}`
        : (preview?.name ?? "Selected household");

  // Step 2: planning-only fields.
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-ok/30 bg-ok/10 px-3 py-2.5 text-[13px] text-ink">
        <CheckCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-ok" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">CRM household linked</p>
          <p className="text-ink-3">{householdLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHouseholdId(null);
            setPreview(null);
          }}
          className="shrink-0 text-[12px] text-ink-3 transition-colors hover:text-ink-2"
        >
          Change
        </button>
      </div>

      {previewError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-ink"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <span>Couldn&apos;t preview household ({previewError}). You can still continue.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={fieldLabelClassName} htmlFor="retirementAge">
            Retirement age
          </label>
          <input
            id="retirementAge"
            name="retirementAge"
            type="number"
            min={50}
            max={85}
            defaultValue={65}
            required
            className={inputClassName}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="retirementMonth">
            Retirement month
          </label>
          <select
            id="retirementMonth"
            name="retirementMonth"
            defaultValue={1}
            className={selectClassName}
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="lifeExpectancy">
            Life expectancy
          </label>
          <input
            id="lifeExpectancy"
            name="lifeExpectancy"
            type="number"
            min={1}
            max={120}
            defaultValue={95}
            required
            className={inputClassName}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="filingStatus">
            Filing status
          </label>
          <select
            id="filingStatus"
            name="filingStatus"
            defaultValue="single"
            required
            className={selectClassName}
          >
            {FILING_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-hair pt-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showSpouse}
            onChange={(e) => setShowSpouse(e.target.checked)}
            className="h-4 w-4 rounded border-hair bg-card-2 text-accent focus:ring-accent"
          />
          <span className="text-[13px] font-medium text-ink-2">Add spouse planning fields</span>
        </label>
        {showSpouse && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={fieldLabelClassName} htmlFor="spouseRetirementAge">
                Spouse retirement age
              </label>
              <input
                id="spouseRetirementAge"
                name="spouseRetirementAge"
                type="number"
                min={50}
                max={85}
                defaultValue={65}
                className={inputClassName}
              />
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="spouseRetirementMonth">
                Spouse retirement month
              </label>
              <select
                id="spouseRetirementMonth"
                name="spouseRetirementMonth"
                defaultValue={1}
                className={selectClassName}
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabelClassName} htmlFor="spouseLifeExpectancy">
                Spouse life expectancy
              </label>
              <input
                id="spouseLifeExpectancy"
                name="spouseLifeExpectancy"
                type="number"
                min={1}
                max={120}
                defaultValue={95}
                className={inputClassName}
              />
            </div>
          </div>
        )}
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
