"use client";

import { useState, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import type { IncomeTaxType } from "@/engine/tax-adjustments";

interface TaxAdjustmentRow {
  id: string;
  taxType: IncomeTaxType;
  name: string | null;
  owner: "client" | "spouse" | "joint";
  /** SIGNED. A negative amount removes income the plan over-counts. */
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
  withheldMode: "none" | "amount" | "percent";
  /** Dollars when mode is "amount"; a 0..1 fraction when "percent". */
  withheldValue: number;
}

interface AddTaxAdjustmentFormProps {
  clientId: string;
  existing?: TaxAdjustmentRow | null;
  onClose: () => void;
  onSaved: () => void;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}

const TYPE_OPTIONS: Array<{ value: TaxAdjustmentRow["taxType"]; label: string }> = [
  { value: "ordinary_income", label: "Ordinary income" },
  { value: "earned_income", label: "Wages (subject to Social Security and Medicare tax)" },
  { value: "dividends", label: "Qualified dividends" },
  { value: "capital_gains", label: "Long-term capital gains" },
  { value: "stcg", label: "Short-term capital gains" },
  { value: "qbi", label: "Business income (QBI)" },
  { value: "tax_exempt", label: "Tax-exempt income" },
];

const INPUT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none";

export function AddTaxAdjustmentForm({
  clientId,
  existing,
  onClose,
  onSaved,
  milestones,
  clientFirstName,
  spouseFirstName,
}: AddTaxAdjustmentFormProps) {
  const writer = useScenarioWriter(clientId);
  const [taxType, setTaxType] = useState<TaxAdjustmentRow["taxType"]>(existing?.taxType ?? "ordinary_income");
  const [name, setName] = useState(existing?.name ?? "");
  const [owner, setOwner] = useState<TaxAdjustmentRow["owner"]>(existing?.owner ?? "joint");
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
  const [withheldMode, setWithheldMode] = useState<"none" | "amount" | "percent">(
    existing?.withheldMode ?? "none"
  );
  // Dollars when mode is "amount"; a 0..1 fraction stored on the row is
  // inverted back to the percent an advisor typed (22.5, not 0.225) for edit.
  const [withheldValue, setWithheldValue] = useState(
    existing
      ? existing.withheldMode === "percent"
        ? (existing.withheldValue * 100).toString()
        : existing.withheldValue.toString()
      : "0"
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body = {
        taxType,
        name: name || null,
        owner,
        annualAmount: parseFloat(annualAmount) || 0,
        growthRate: parseFloat(growthRate) / 100 || 0,
        startYear,
        endYear,
        startYearRef,
        endYearRef,
        withheldMode,
        withheldValue:
          withheldMode === "none" ? 0
          : withheldMode === "percent" ? (parseFloat(withheldValue) || 0) / 100
          : parseFloat(withheldValue) || 0,
      };

      const newAdjustmentId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;

      const res = existing
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "client_tax_adjustment",
              targetId: existing.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/tax-adjustments/${existing.id}`,
              method: "PUT",
              body,
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "client_tax_adjustment",
              entity: { id: newAdjustmentId, ...body },
            },
            {
              url: `/api/clients/${clientId}/tax-adjustments`,
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
          <h3 className="text-base font-semibold text-gray-100">
            {existing ? "Edit tax adjustment" : "Add tax adjustment"}
          </h3>
          <button type="button" onClick={onClose} className="text-xl text-gray-300 hover:text-gray-200" aria-label="Close">
            ×
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300">Tax treatment</label>
          <select
            value={taxType}
            onChange={(e) => setTaxType(e.target.value as TaxAdjustmentRow["taxType"])}
            className={SELECT_CLASS}
            aria-label="Tax treatment"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300">Description (optional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., 2026 Roth conversion"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300">Owner</label>
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value as TaxAdjustmentRow["owner"])}
            className={SELECT_CLASS}
            aria-label="Owner"
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
              value={annualAmount}
              onChange={(e) => setAnnualAmount(e.target.value)}
              required
              className={INPUT_CLASS}
              aria-label="Annual amount"
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

        {parseFloat(annualAmount) > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-300">Tax already paid</label>
            <div className="mt-1 flex gap-2">
              <select
                value={withheldMode}
                onChange={(e) => setWithheldMode(e.target.value as "none" | "amount" | "percent")}
                className={SELECT_CLASS}
                aria-label="Tax already paid mode"
              >
                <option value="none">None</option>
                <option value="amount">$ amount</option>
                <option value="percent">% of amount</option>
              </select>
              {withheldMode !== "none" && (
                <input
                  type="number"
                  step="any"
                  value={withheldValue}
                  onChange={(e) => setWithheldValue(e.target.value)}
                  className={INPUT_CLASS}
                  aria-label={withheldMode === "percent" ? "Percent withheld" : "Amount withheld"}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              What was already withheld or paid on this item. The plan still shows the full tax bill —
              it just won&apos;t take this part out of the accounts a second time.
            </p>
          </div>
        )}

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
              position="end"
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
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
