"use client";

import { useState } from "react";
import type { MedicareCoverage } from "@/engine/types";
import { inputClassName, selectClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import {
  DEFAULT_MEDIGAP_MONTHLY_AT_BASE_YEAR,
  DEFAULT_PART_D_PLAN_MONTHLY_AT_BASE_YEAR,
  DEFAULT_MEDICARE_ENROLLMENT_AGE,
} from "@/lib/medicare/constants";

interface Props {
  clientId: string;
  owner: "client" | "spouse";
  existing: MedicareCoverage | null;
  /** YYYY-MM-DD; used to default enrollment year to the year the person turns 65. */
  ownerDob?: string | null;
  onSaved: (coverage: MedicareCoverage) => void;
}

function defaultEnrollmentYear(dob?: string | null): number | null {
  if (!dob) return null;
  const birthYear = Number(dob.slice(0, 4));
  if (!Number.isFinite(birthYear)) return null;
  return birthYear + DEFAULT_MEDICARE_ENROLLMENT_AGE;
}

export function MedicareDialogTab({ clientId, owner, existing, ownerDob, onSaved }: Props) {
  const [enrollmentYear, setEnrollmentYear] = useState<number | null>(
    existing?.enrollmentYear ?? defaultEnrollmentYear(ownerDob),
  );
  const [coverageType, setCoverageType] = useState<"original" | "advantage">(existing?.coverageType ?? "original");
  const [medigap, setMedigap] = useState<number | null>(
    existing?.medigapMonthlyAt65 ?? DEFAULT_MEDIGAP_MONTHLY_AT_BASE_YEAR,
  );
  const [partD, setPartD] = useState<number | null>(
    existing?.partDPlanMonthlyAt65 ?? DEFAULT_PART_D_PLAN_MONTHLY_AT_BASE_YEAR,
  );
  const [priorMagi, setPriorMagi] = useState<number | null>(existing?.priorYearMagi ?? null);
  const [estimateFromProjection, setEstimateFromProjection] = useState<boolean>(
    existing?.estimatePriorYearMagiFromProjection ?? false,
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const payload: MedicareCoverage = {
      owner,
      enrollmentYear,
      coverageType,
      medigapMonthlyAt65: medigap,
      partDPlanMonthlyAt65: partD,
      priorYearMagi: priorMagi,
      estimatePriorYearMagiFromProjection: estimateFromProjection,
    };
    const res = await fetch(`/api/clients/${clientId}/medicare-coverage`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const text = await res.text();
      alert(`Save failed: ${text}`);
      return;
    }
    onSaved(payload);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="medicare-enrollment-year" className={fieldLabelClassName}>Enrollment year</label>
        <input
          id="medicare-enrollment-year"
          type="number"
          aria-label="enrollment year"
          value={enrollmentYear ?? ""}
          placeholder="Year person turns 65"
          onChange={e => setEnrollmentYear(e.target.value ? Number(e.target.value) : null)}
          className={inputClassName}
        />
        <p className="text-[11px] text-ink-3 mt-1">Defer if still on employer plan past 65.</p>
      </div>

      <div>
        <label htmlFor="medicare-coverage-type" className={fieldLabelClassName}>Coverage type</label>
        <select
          id="medicare-coverage-type"
          aria-label="coverage type"
          value={coverageType}
          onChange={e => setCoverageType(e.target.value as "original" | "advantage")}
          className={selectClassName}
        >
          <option value="original">Original Medicare</option>
          <option value="advantage">Medicare Advantage</option>
        </select>
      </div>

      <div>
        <label htmlFor="medicare-medigap" className={fieldLabelClassName}>Medigap monthly ($)</label>
        <input
          id="medicare-medigap"
          type="number"
          aria-label="medigap monthly"
          value={medigap ?? ""}
          placeholder="National avg ~$170"
          onChange={e => setMedigap(e.target.value ? Number(e.target.value) : null)}
          className={inputClassName}
        />
      </div>

      <div>
        <label htmlFor="medicare-partd" className={fieldLabelClassName}>Part D plan monthly ($)</label>
        <input
          id="medicare-partd"
          type="number"
          aria-label="part d monthly"
          value={partD ?? ""}
          placeholder="National avg ~$46"
          onChange={e => setPartD(e.target.value ? Number(e.target.value) : null)}
          className={inputClassName}
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer">
          <input
            type="checkbox"
            aria-label="estimate prior-year magi from projection"
            checked={estimateFromProjection}
            onChange={(e) => setEstimateFromProjection(e.target.checked)}
            className="h-4 w-4 rounded border-hair text-accent focus:ring-1 focus:ring-accent"
          />
          <span>Estimate prior-year MAGI from projection</span>
        </label>
        {!estimateFromProjection && (
          <div className="mt-3">
            <label htmlFor="medicare-magi" className={fieldLabelClassName}>Prior-year MAGI ($, optional)</label>
            <input
              id="medicare-magi"
              type="number"
              aria-label="prior year magi"
              value={priorMagi ?? ""}
              placeholder="Used for IRMAA in years 1–2"
              onChange={e => setPriorMagi(e.target.value ? Number(e.target.value) : null)}
              className={inputClassName}
            />
            <p className="text-[11px] text-ink-3 mt-1">Leave blank to estimate from the current-year projection.</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="self-end rounded-[var(--radius-sm)] bg-accent text-accent-on px-4 h-9 text-[13px] font-medium hover:bg-accent-ink disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
