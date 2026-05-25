"use client";

import { useState } from "react";
import type { MedicareCoverage } from "@/engine/types";
import { inputClassName, selectClassName, fieldLabelClassName } from "@/components/forms/input-styles";

interface Props {
  clientId: string;
  owner: "client" | "spouse";
  existing: MedicareCoverage | null;
  onSaved: (coverage: MedicareCoverage) => void;
}

export function MedicareDialogTab({ clientId, owner, existing, onSaved }: Props) {
  const [enrollmentYear, setEnrollmentYear] = useState<number | null>(existing?.enrollmentYear ?? null);
  const [coverageType, setCoverageType] = useState<"original" | "advantage">(existing?.coverageType ?? "original");
  const [medigap, setMedigap] = useState<number | null>(existing?.medigapMonthlyAt65 ?? null);
  const [partD, setPartD] = useState<number | null>(existing?.partDPlanMonthlyAt65 ?? null);
  const [priorMagi, setPriorMagi] = useState<number | null>(existing?.priorYearMagi ?? null);
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
    };
    const res = await fetch(`/api/clients/${clientId}/medicare-coverage`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) onSaved(payload);
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
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="self-end rounded-[var(--radius-sm)] bg-accent text-accent-on px-4 h-9 text-[13px] font-medium hover:bg-accent-deep disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
