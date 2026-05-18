"use client";

import { useState, useEffect, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import type { Reinvestment } from "@/engine/types";

/**
 * Shape passed in when editing. The card-level fields come straight from
 * `ReinvestmentRow`; the editable detail fields (`modelPortfolioId`,
 * `customGrowthRate`, custom realization percents) are not carried on the row,
 * so the form fetches them from `GET /api/clients/:id/reinvestments` on mount.
 */
export interface ReinvestmentInitialData {
  id: string;
  name: string;
  accountIds: string[];
  year: number;
  yearRef: string | null;
  targetType: "model_portfolio" | "custom";
  realizeTaxesOnSwitch: boolean;
}

interface AddReinvestmentFormProps {
  clientId: string;
  accounts: { id: string; name: string; category: string; subType: string }[];
  modelPortfolios: { id: string; name: string }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialData?: ReinvestmentInitialData;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, emit the assembled Reinvestment instead of persisting.
   *  Resolved fields (newGrowthRate / soldFractionByAccount) are placeholders;
   *  the solver's /project route re-resolves them server-side. */
  onSubmitDraft?: (technique: Reinvestment) => void;
}

const INPUT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none";

function makeId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tmp-${Date.now()}`;
}

/** Convert a stored decimal fraction (e.g. "0.06") to a percent string ("6"). */
function toPercentString(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "";
  return String(num * 100);
}

export default function AddReinvestmentForm({
  clientId,
  accounts,
  modelPortfolios,
  milestones,
  clientFirstName,
  spouseFirstName,
  initialData,
  onClose,
  onSaved,
  onSubmitDraft,
}: AddReinvestmentFormProps) {
  const writer = useScenarioWriter(clientId);

  // Reinvestments only operate on liquid accounts — exclude business / real estate.
  const liquidAccounts = accounts.filter(
    (a) => !["business", "real_estate"].includes(a.category),
  );

  const [name, setName] = useState(initialData?.name ?? "");
  const [accountIds, setAccountIds] = useState<string[]>(
    initialData?.accountIds ?? [],
  );
  const [year, setYear] = useState(initialData?.year ?? new Date().getFullYear());
  const [yearRef, setYearRef] = useState<YearRef | null>(
    (initialData?.yearRef as YearRef | null) ?? null,
  );
  const [targetType, setTargetType] = useState<"model_portfolio" | "custom">(
    initialData?.targetType ?? "model_portfolio",
  );
  const [modelPortfolioId, setModelPortfolioId] = useState<string>(
    modelPortfolios[0]?.id ?? "",
  );
  const [customGrowthRate, setCustomGrowthRate] = useState("");
  const [pctOrdinary, setPctOrdinary] = useState("");
  const [pctLtGains, setPctLtGains] = useState("");
  const [pctQualifiedDiv, setPctQualifiedDiv] = useState("");
  const [pctTaxExempt, setPctTaxExempt] = useState("");
  const [realizeTaxesOnSwitch, setRealizeTaxesOnSwitch] = useState(
    initialData?.realizeTaxesOnSwitch ?? false,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On edit, re-fetch the editable detail fields from the API.
  // ReinvestmentRow is mapped from the framework-free engine type
  // `Reinvestment`, which deliberately carries only the *resolved* growth
  // profile (newGrowthRate/newRealization) — not the raw DB inputs the edit
  // form needs (modelPortfolioId, customGrowthRate, custom realization %s).
  // Those are resolved away at load time; the engine never needs them. Rather
  // than pollute the engine type with DB/UI shape, the form re-fetches them.
  useEffect(() => {
    if (!initialData) return;
    const editId = initialData.id;
    let cancelled = false;
    async function loadDetail() {
      try {
        const res = await fetch(`/api/clients/${clientId}/reinvestments`);
        if (!res.ok) return;
        const rows: Array<{
          id: string;
          modelPortfolioId: string | null;
          customGrowthRate: string | null;
          customPctOrdinaryIncome: string | null;
          customPctLtCapitalGains: string | null;
          customPctQualifiedDividends: string | null;
          customPctTaxExempt: string | null;
        }> = await res.json();
        const row = rows.find((r) => r.id === editId);
        if (!row || cancelled) return;
        if (row.modelPortfolioId) setModelPortfolioId(row.modelPortfolioId);
        setCustomGrowthRate(toPercentString(row.customGrowthRate));
        setPctOrdinary(toPercentString(row.customPctOrdinaryIncome));
        setPctLtGains(toPercentString(row.customPctLtCapitalGains));
        setPctQualifiedDiv(toPercentString(row.customPctQualifiedDividends));
        setPctTaxExempt(toPercentString(row.customPctTaxExempt));
      } catch {
        // Detail fetch failed — the form still works with defaults.
      }
    }
    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [clientId, initialData]);

  function toggleAccount(accountId: string) {
    setAccountIds((ids) =>
      ids.includes(accountId)
        ? ids.filter((id) => id !== accountId)
        : [...ids, accountId],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // ── Client-side validation ─────────────────────────────────────────────
    if (accountIds.length === 0) {
      setError("Select at least one account.");
      return;
    }
    if (targetType === "model_portfolio" && !modelPortfolioId) {
      setError("Select a model portfolio.");
      return;
    }
    if (targetType === "custom" && !customGrowthRate) {
      setError("Enter a custom growth rate.");
      return;
    }

    // Custom realization split: if any percent is entered, all four must
    // be present and sum to 100%.
    const realizationEntries = [pctOrdinary, pctLtGains, pctQualifiedDiv, pctTaxExempt];
    const anyRealizationEntered = realizationEntries.some((v) => v !== "");
    let customRealization:
      | {
          customPctOrdinaryIncome: number;
          customPctLtCapitalGains: number;
          customPctQualifiedDividends: number;
          customPctTaxExempt: number;
        }
      | null = null;

    if (targetType === "custom" && anyRealizationEntered) {
      const nums = realizationEntries.map((v) => (parseFloat(v) || 0) / 100);
      const sum = nums.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-6) {
        setError("Realization percentages must sum to 100%.");
        return;
      }
      customRealization = {
        customPctOrdinaryIncome: nums[0],
        customPctLtCapitalGains: nums[1],
        customPctQualifiedDividends: nums[2],
        customPctTaxExempt: nums[3],
      };
    }

    setSubmitting(true);
    try {
      const body = {
        name,
        year,
        yearRef,
        targetType,
        modelPortfolioId: targetType === "model_portfolio" ? modelPortfolioId : null,
        customGrowthRate:
          targetType === "custom" ? (parseFloat(customGrowthRate) || 0) / 100 : null,
        customPctOrdinaryIncome: customRealization?.customPctOrdinaryIncome ?? null,
        customPctLtCapitalGains: customRealization?.customPctLtCapitalGains ?? null,
        customPctQualifiedDividends: customRealization?.customPctQualifiedDividends ?? null,
        customPctTaxExempt: customRealization?.customPctTaxExempt ?? null,
        realizeTaxesOnSwitch,
        accountIds,
      };

      const newReinvestmentId = makeId();

      if (onSubmitDraft) {
        const technique: Reinvestment = {
          id: initialData?.id ?? newReinvestmentId,
          name: body.name,
          accountIds: body.accountIds,
          year: body.year,
          realizeTaxesOnSwitch: body.realizeTaxesOnSwitch,
          // Resolved fields — placeholders; resolveReinvestments overwrites them.
          newGrowthRate: 0,
          soldFractionByAccount: {},
          // Raw resolution inputs consumed by resolveReinvestments.
          targetType: body.targetType,
          modelPortfolioId: body.modelPortfolioId,
          customGrowthRate: body.customGrowthRate,
          customPctOrdinaryIncome: body.customPctOrdinaryIncome,
          customPctLtCapitalGains: body.customPctLtCapitalGains,
          customPctQualifiedDividends: body.customPctQualifiedDividends,
          customPctTaxExempt: body.customPctTaxExempt,
          ...(body.yearRef != null ? { yearRef: body.yearRef } : {}),
        };
        onSubmitDraft(technique);
        onSaved();
        return;
      }

      const res = initialData
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "reinvestment",
              targetId: initialData.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/reinvestments`,
              method: "PUT",
              body: { reinvestmentId: initialData.id, ...body },
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "reinvestment",
              entity: { id: newReinvestmentId, ...body },
            },
            {
              url: `/api/clients/${clientId}/reinvestments`,
              method: "POST",
              body,
            },
          );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(
          `Failed to save: ${(err as { error?: string }).error ?? res.statusText}`,
        );
        return;
      }

      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-3 rounded-xl border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-5 shadow-xl"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">
            {initialData ? "Edit Reinvestment" : "Add Reinvestment"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xl text-gray-300 hover:text-gray-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-300">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Shift to growth portfolio at retirement"
            required
            className={INPUT_CLASS}
          />
        </div>

        {/* Accounts */}
        <div>
          <label className="block text-xs font-medium text-gray-300">Accounts</label>
          {liquidAccounts.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">No eligible accounts.</p>
          ) : (
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border border-gray-700 bg-gray-900 p-2">
              {liquidAccounts.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 text-sm text-gray-200"
                >
                  <input
                    type="checkbox"
                    checked={accountIds.includes(a.id)}
                    onChange={() => toggleAccount(a.id)}
                    className="rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                  />
                  {a.name}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Year */}
        <div>
          {milestones ? (
            <MilestoneYearPicker
              name="year"
              id="reinvestment-year"
              value={year}
              yearRef={yearRef}
              milestones={milestones}
              onChange={(y, r) => {
                setYear(y);
                setYearRef(r);
              }}
              label="Year"
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
              position="start"
            />
          ) : (
            <>
              <label className="block text-xs font-medium text-gray-300">Year</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => {
                  setYear(Number(e.target.value));
                  setYearRef(null);
                }}
                required
                className={INPUT_CLASS}
              />
            </>
          )}
        </div>

        {/* Target type */}
        <div>
          <label className="block text-xs font-medium text-gray-300">Target</label>
          <div className="mt-1 flex gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input
                type="radio"
                name="targetType"
                checked={targetType === "model_portfolio"}
                onChange={() => setTargetType("model_portfolio")}
                className="text-accent focus:ring-accent"
              />
              Model portfolio
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input
                type="radio"
                name="targetType"
                checked={targetType === "custom"}
                onChange={() => setTargetType("custom")}
                className="text-accent focus:ring-accent"
              />
              Custom growth rate
            </label>
          </div>
        </div>

        {/* Model portfolio dropdown */}
        {targetType === "model_portfolio" && (
          <div>
            <label className="block text-xs font-medium text-gray-300">
              Model portfolio
            </label>
            {modelPortfolios.length === 0 ? (
              <p className="mt-1 text-xs text-gray-400">
                No model portfolios available.
              </p>
            ) : (
              <select
                value={modelPortfolioId}
                onChange={(e) => setModelPortfolioId(e.target.value)}
                className={SELECT_CLASS}
              >
                {modelPortfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Custom growth rate + optional realization split */}
        {targetType === "custom" && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-300">
                Growth rate (% / yr)
              </label>
              <PercentInput
                value={customGrowthRate}
                onChange={(raw) => setCustomGrowthRate(raw)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300">
                Realization split (optional)
              </label>
              <p className="mt-0.5 text-xs text-gray-400">
                Defaults to 100% ordinary income.
              </p>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400">
                    Ordinary income
                  </label>
                  <PercentInput
                    value={pctOrdinary}
                    onChange={(raw) => setPctOrdinary(raw)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400">
                    LT capital gains
                  </label>
                  <PercentInput
                    value={pctLtGains}
                    onChange={(raw) => setPctLtGains(raw)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400">
                    Qualified dividends
                  </label>
                  <PercentInput
                    value={pctQualifiedDiv}
                    onChange={(raw) => setPctQualifiedDiv(raw)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400">Tax-exempt</label>
                  <PercentInput
                    value={pctTaxExempt}
                    onChange={(raw) => setPctTaxExempt(raw)}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Apply taxes on switch */}
        <div>
          <label className="flex items-start gap-2 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={realizeTaxesOnSwitch}
              onChange={(e) => setRealizeTaxesOnSwitch(e.target.checked)}
              className="mt-0.5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
            />
            <span>
              Apply taxes on switch
              <span className="mt-0.5 block text-xs text-gray-400">
                Taxable accounts realize capital gains for the portion of
                holdings the reallocation sells.
              </span>
            </span>
          </label>
        </div>

        {error && <p className="text-xs font-medium text-red-400">{error}</p>}

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
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
