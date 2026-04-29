"use client";

import { useState, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";

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

const INPUT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none";

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
        className="w-full max-w-md space-y-3 rounded-xl border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">{existing ? "Edit deduction" : "Add deduction"}</h3>
          <button type="button" onClick={onClose} className="text-xl text-gray-300 hover:text-gray-200" aria-label="Close">
            ×
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DeductionRow["type"])}
            className={SELECT_CLASS}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {type === "property_tax" && (
          <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
            Property taxes are subject to the SALT cap ($40k for 2026+, $10k pre-2026).
            Enter your full amount; the engine will apply the cap.
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-300">Name (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., First Baptist Church"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300">Owner</label>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value as DeductionRow["owner"])}
            className={SELECT_CLASS}
          >
            <option value="joint">Joint</option>
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-300">Annual amount ($)</label>
            <input
              type="number"
              step="100"
              min="0"
              value={annualAmount}
              onChange={(e) => setAnnualAmount(e.target.value)}
              required
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-300">Growth rate (% / yr)</label>
            <PercentInput
              value={growthRate}
              onChange={(raw) => setGrowthRate(raw)}
              className={INPUT_CLASS}
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
            />
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-300">Start year</label>
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
                className={INPUT_CLASS}
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
            />
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-300">End year</label>
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
                className={INPUT_CLASS}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
