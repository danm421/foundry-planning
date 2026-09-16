"use client";

import { useState, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { fieldLabelClassName, inputClassName, selectClassName } from "./input-styles";

interface DeductionRow {
  id: string;
  type: "charitable" | "above_line" | "below_line" | "property_tax";
  name: string | null;
  owner: "client" | "spouse" | "joint";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
}

interface AddDeductionFormProps {
  clientId: string;
  existing?: DeductionRow | null;
  onClose: () => void;
  onSaved: () => void;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}

const TYPE_OPTIONS: Array<{ value: DeductionRow["type"]; label: string }> = [
  { value: "charitable", label: "Charitable" },
  { value: "above_line", label: "Above-the-Line" },
  { value: "below_line", label: "Below-the-Line" },
  { value: "property_tax", label: "Property Tax (SALT)" },
];

export function AddDeductionForm({
  clientId,
  existing,
  onClose,
  onSaved,
  milestones,
  clientFirstName,
  spouseFirstName,
}: AddDeductionFormProps) {
  const writer = useScenarioWriter(clientId);
  const [type, setType] = useState<DeductionRow["type"]>(existing?.type ?? "charitable");
  const [name, setName] = useState(existing?.name ?? "");
  const [owner, setOwner] = useState<DeductionRow["owner"]>(existing?.owner ?? "joint");
  const [annualAmount, setAnnualAmount] = useState(existing?.annualAmount?.toString() ?? "");
  const [growthRate, setGrowthRate] = useState(existing ? (existing.growthRate * 100).toString() : "0");
  const [startYear, setStartYear] = useState(existing?.startYear ?? new Date().getFullYear());
  const [endYear, setEndYear] = useState(existing?.endYear ?? new Date().getFullYear() + 50);
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (existing?.startYearRef as YearRef | null) ?? null
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (existing?.endYearRef as YearRef | null) ?? null
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body = {
        type,
        name: name || null,
        owner,
        annualAmount: parseFloat(annualAmount) || 0,
        growthRate: parseFloat(growthRate) / 100 || 0,
        startYear,
        endYear,
        startYearRef,
        endYearRef,
      };

      const newDeductionId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;

      const res = existing
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "client_deduction",
              targetId: existing.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/deductions/${existing.id}`,
              method: "PUT",
              body,
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "client_deduction",
              entity: { id: newDeductionId, ...body },
            },
            {
              url: `/api/clients/${clientId}/deductions`,
              method: "POST",
              body,
            },
          );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to save: ${(err as { error?: string }).error ?? res.statusText}`);
        return;
      }

      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-xl border-2 border-ink-3 ring-1 ring-black/60 bg-card p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">{existing ? "Edit deduction" : "Add deduction"}</h3>
          <button type="button" onClick={onClose} className="text-xl text-ink-3 hover:text-ink-2" aria-label="Close">
            ×
          </button>
        </div>

        <div>
          <label className={fieldLabelClassName}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DeductionRow["type"])}
            className={selectClassName}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {type === "property_tax" && (
          <p className="rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
            Property taxes are subject to the SALT cap ($40k for 2026+, $10k pre-2026).
            Enter your full amount; the engine will apply the cap.
          </p>
        )}

        <div>
          <label className={fieldLabelClassName}>Name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., First Baptist Church"
            className={inputClassName}
          />
        </div>

        <div>
          <label className={fieldLabelClassName}>Owner</label>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value as DeductionRow["owner"])}
            className={selectClassName}
          >
            <option value="joint">Joint</option>
            <option value="client">Client</option>
            <option value="spouse">Co-client</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName}>Annual amount ($)</label>
            <input
              type="number"
              step="100"
              min="0"
              value={annualAmount}
              onChange={(e) => setAnnualAmount(e.target.value)}
              required
              className={inputClassName}
            />
          </div>
          <div>
            <label className={fieldLabelClassName}>Growth rate (% / yr)</label>
            <PercentInput
              value={growthRate}
              onChange={(raw) => setGrowthRate(raw)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {milestones ? (
            <MilestoneYearPicker
              name="startYear"
              id="startYear"
              value={startYear}
              yearRef={startYearRef}
              milestones={milestones}
              onChange={(yr, ref) => {
                setStartYear(yr);
                setStartYearRef(ref);
              }}
              label="Start year"
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
              position="start"
            />
          ) : (
            <div>
              <label className={fieldLabelClassName}>Start year</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={startYear}
                onChange={(e) => {
                  setStartYear(Number(e.target.value));
                  setStartYearRef(null);
                }}
                required
                className={inputClassName}
              />
            </div>
          )}
          {milestones ? (
            <MilestoneYearPicker
              name="endYear"
              id="endYear"
              value={endYear}
              yearRef={endYearRef}
              milestones={milestones}
              onChange={(yr, ref) => {
                setEndYear(yr);
                setEndYearRef(ref);
              }}
              label="End year"
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
              startYearForDuration={startYear}
              position="end"
            />
          ) : (
            <div>
              <label className={fieldLabelClassName}>End year</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={endYear}
                onChange={(e) => {
                  setEndYear(Number(e.target.value));
                  setEndYearRef(null);
                }}
                required
                className={inputClassName}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-ink-3 hover:bg-card-hover hover:text-ink-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
