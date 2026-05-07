"use client";

import { useState, useMemo, FormEvent } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import type { RothConversionType } from "@/engine/types";

const ROTH_SUBTYPES = new Set(["roth_ira"]);
const TAX_DEFERRED_SUBTYPES = new Set(["traditional_ira", "401k", "403b", "sep_ira", "simple_ira"]);

const INPUT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const SELECT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none";

const CONVERSION_TYPE_OPTIONS: { value: RothConversionType; label: string; sub: string }[] = [
  { value: "fixed_amount", label: "Fixed Amount", sub: "Convert a set dollar amount each year" },
  { value: "full_account", label: "Full Account Value", sub: "Convert the entire source pool in year 1" },
  { value: "deplete_over_period", label: "Deplete Over Period", sub: "Spread the source pool evenly over the window" },
  { value: "fill_up_bracket", label: "Fill Up Tax Bracket", sub: "Convert just enough to top out the chosen bracket" },
];

const BRACKET_OPTIONS = [
  { value: 0.10, label: "10% bracket" },
  { value: 0.12, label: "12% bracket" },
  { value: 0.22, label: "22% bracket" },
  { value: 0.24, label: "24% bracket" },
  { value: 0.32, label: "32% bracket" },
  { value: 0.35, label: "35% bracket" },
  { value: 0.37, label: "37% bracket" },
];

export interface RothConversionInitialData {
  id: string;
  name: string;
  destinationAccountId: string;
  sourceAccountIds: string[];
  conversionType: RothConversionType;
  fixedAmount: string;
  fillUpBracket: string | null;
  startYear: number;
  startYearRef: string | null;
  endYear: number | null;
  endYearRef: string | null;
  indexingRate: string;
  inflationStartYear: number | null;
}

interface Props {
  clientId: string;
  accounts: { id: string; name: string; category: string; subType: string }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialData?: RothConversionInitialData;
  onClose: () => void;
  onSaved: () => void;
}

export default function AddRothConversionForm({
  clientId,
  accounts,
  milestones,
  clientFirstName,
  spouseFirstName,
  initialData,
  onClose,
  onSaved,
}: Props) {
  const writer = useScenarioWriter(clientId);

  const rothAccounts = useMemo(
    () => accounts.filter((a) => a.category === "retirement" && ROTH_SUBTYPES.has(a.subType)),
    [accounts],
  );
  const eligibleSources = useMemo(
    () => accounts.filter((a) => a.category === "retirement" && TAX_DEFERRED_SUBTYPES.has(a.subType)),
    [accounts],
  );

  const [name, setName] = useState(initialData?.name ?? "Roth Conversion");
  const [destinationAccountId, setDestinationAccountId] = useState(
    initialData?.destinationAccountId ?? rothAccounts[0]?.id ?? "",
  );
  const [conversionType, setConversionType] = useState<RothConversionType>(
    initialData?.conversionType ?? "fixed_amount",
  );
  const [fixedAmount, setFixedAmount] = useState(initialData?.fixedAmount ?? "");
  const [fillUpBracket, setFillUpBracket] = useState<number>(
    initialData?.fillUpBracket != null ? parseFloat(initialData.fillUpBracket) : 0.22,
  );
  const [startYear, setStartYear] = useState(
    initialData?.startYear ?? new Date().getFullYear(),
  );
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (initialData?.startYearRef as YearRef | null) ?? null,
  );
  const [endYear, setEndYear] = useState<number>(
    initialData?.endYear ?? new Date().getFullYear() + 5,
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (initialData?.endYearRef as YearRef | null) ?? null,
  );
  const [indexingRate, setIndexingRate] = useState(
    initialData ? (parseFloat(initialData.indexingRate) * 100).toString() : "0",
  );
  const [startIndexingMode, setStartIndexingMode] = useState<"immediately" | "at_start">(
    initialData?.inflationStartYear == null ? "immediately" : "at_start",
  );
  const [sourceAccountIds, setSourceAccountIds] = useState<string[]>(
    initialData?.sourceAccountIds ?? [],
  );
  const [submitting, setSubmitting] = useState(false);

  const requiresEndYear = conversionType === "deplete_over_period";
  const showFixedAmount = conversionType === "fixed_amount";
  const showBracketSelect = conversionType === "fill_up_bracket";
  const showIndexing = conversionType === "fixed_amount";

  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  function toggleSource(id: string) {
    setSourceAccountIds((curr) =>
      curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
    );
  }

  function moveSource(id: string, dir: -1 | 1) {
    setSourceAccountIds((curr) => {
      const idx = curr.indexOf(id);
      if (idx < 0) return curr;
      const target = idx + dir;
      if (target < 0 || target >= curr.length) return curr;
      const copy = [...curr];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!destinationAccountId) {
      alert("Pick a destination Roth account before saving.");
      return;
    }
    if (sourceAccountIds.length === 0) {
      alert("Pick at least one source account.");
      return;
    }
    if (showFixedAmount && (!fixedAmount || parseFloat(fixedAmount) <= 0)) {
      alert("Enter a fixed amount greater than zero.");
      return;
    }
    if (requiresEndYear && endYear <= startYear - 1) {
      alert("End year must be on or after start year.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name,
        destinationAccountId,
        sourceAccountIds,
        conversionType,
        fixedAmount: showFixedAmount ? parseFloat(fixedAmount) || 0 : 0,
        fillUpBracket: showBracketSelect ? fillUpBracket : null,
        startYear,
        endYear: requiresEndYear || conversionType === "fill_up_bracket" || conversionType === "fixed_amount"
          ? endYear
          : null,
        startYearRef,
        endYearRef:
          requiresEndYear || conversionType === "fill_up_bracket" || conversionType === "fixed_amount"
            ? endYearRef
            : null,
        indexingRate: showIndexing ? (parseFloat(indexingRate) || 0) / 100 : 0,
        inflationStartYear:
          showIndexing && startIndexingMode === "at_start" ? startYear : null,
      };

      const baseUrl = `/api/clients/${clientId}/roth-conversions`;
      const baseMethod = initialData ? "PUT" : "POST";
      const basePayload = initialData
        ? { rothConversionId: initialData.id, ...body }
        : body;

      const res = initialData
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "roth_conversion",
              targetId: initialData.id,
              desiredFields: body,
            },
            { url: baseUrl, method: baseMethod, body: basePayload },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "roth_conversion",
              entity: { id: crypto.randomUUID(), ...body },
            },
            { url: baseUrl, method: baseMethod, body: basePayload },
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl space-y-4 rounded-xl border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-5 shadow-xl"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">
            {initialData ? "Edit Roth Conversion" : "New Roth Conversion"}
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
            placeholder="e.g., Roth Conversion 1"
            required
            className={INPUT_CLASS}
          />
        </div>

        {/* Years */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            {milestones ? (
              <MilestoneYearPicker
                name="startYear"
                id="rc-startYear"
                value={startYear}
                yearRef={startYearRef}
                milestones={milestones}
                onChange={(y, r) => { setStartYear(y); setStartYearRef(r); }}
                label="Starts"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName}
                position="start"
              />
            ) : (
              <>
                <label className="block text-xs font-medium text-gray-300">Starts</label>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={startYear}
                  onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                  className={INPUT_CLASS}
                />
              </>
            )}
          </div>
          <div>
            {milestones ? (
              <MilestoneYearPicker
                name="endYear"
                id="rc-endYear"
                value={endYear}
                yearRef={endYearRef}
                milestones={milestones}
                onChange={(y, r) => { setEndYear(y); setEndYearRef(r); }}
                label="Ends"
                clientFirstName={clientFirstName}
                spouseFirstName={spouseFirstName}
                startYearForDuration={startYear}
                position="end"
              />
            ) : (
              <>
                <label className="block text-xs font-medium text-gray-300">Ends</label>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={endYear}
                  onChange={(e) => { setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                  className={INPUT_CLASS}
                />
              </>
            )}
          </div>
        </div>

        {/* Destination */}
        <div>
          <label className="block text-xs font-medium text-gray-300">Destination Account</label>
          {rothAccounts.length === 0 ? (
            <p className="mt-1 rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1.5 text-xs text-amber-300">
              No Roth account on this plan yet. Add a Roth IRA or Roth 401(k) account first.
            </p>
          ) : (
            <select
              value={destinationAccountId}
              onChange={(e) => setDestinationAccountId(e.target.value)}
              className={SELECT_CLASS}
              required
            >
              {rothAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Conversion type — segmented */}
        <div>
          <label className="block text-xs font-medium text-gray-300">Conversion Type</label>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CONVERSION_TYPE_OPTIONS.map((opt) => {
              const active = conversionType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setConversionType(opt.value)}
                  className={`rounded border px-2 py-1.5 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent/15 text-accent-ink"
                      : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600 hover:text-gray-200"
                  }`}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="mt-0.5 text-[10px] leading-tight text-gray-400">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Fixed amount */}
        {showFixedAmount && (
          <div>
            <label htmlFor="rc-fixedAmount" className="block text-xs font-medium text-gray-300">Fixed Amount ($/yr)</label>
            <CurrencyInput
              id="rc-fixedAmount"
              value={fixedAmount}
              onChange={(raw) => setFixedAmount(raw)}
              required
              className={INPUT_CLASS.replace("px-2", "pr-2")}
            />
          </div>
        )}

        {/* Bracket selector */}
        {showBracketSelect && (
          <div>
            <label className="block text-xs font-medium text-gray-300">Fill Up To</label>
            <select
              value={fillUpBracket}
              onChange={(e) => setFillUpBracket(parseFloat(e.target.value))}
              className={SELECT_CLASS}
            >
              {BRACKET_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Each year, convert just enough to top out the selected ordinary-income bracket.
            </p>
          </div>
        )}

        {/* Indexing — fixed_amount only */}
        {showIndexing && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-300">Indexed At (% / yr)</label>
              <PercentInput
                value={indexingRate}
                onChange={(raw) => setIndexingRate(raw)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300">Start Indexing</label>
              <select
                value={startIndexingMode}
                onChange={(e) => setStartIndexingMode(e.target.value as "immediately" | "at_start")}
                className={SELECT_CLASS}
              >
                <option value="immediately">Immediately</option>
                <option value="at_start">At Start Year</option>
              </select>
            </div>
          </div>
        )}

        {/* Accounts to convert */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-300">Accounts to Convert</label>
            <span className="text-[10px] text-gray-400">
              Drained in order. Use ↑ ↓ to reorder.
            </span>
          </div>
          {eligibleSources.length === 0 ? (
            <p className="rounded border border-amber-700/50 bg-amber-900/20 px-2 py-1.5 text-xs text-amber-300">
              No Traditional IRA / 401(k) / SEP / SIMPLE accounts available.
            </p>
          ) : (
            <div className="space-y-1">
              {/* Selected sources, in order */}
              {sourceAccountIds.map((id, idx) => {
                const a = accountMap.get(id);
                if (!a) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between rounded border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-gray-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">{idx + 1}.</span>
                      <span>{a.name}</span>
                      <span className="text-[10px] text-gray-400">({a.subType})</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveSource(id, -1)}
                        className="px-1 text-gray-400 hover:text-gray-200 disabled:opacity-30"
                        aria-label="Move up"
                      >↑</button>
                      <button
                        type="button"
                        disabled={idx === sourceAccountIds.length - 1}
                        onClick={() => moveSource(id, 1)}
                        className="px-1 text-gray-400 hover:text-gray-200 disabled:opacity-30"
                        aria-label="Move down"
                      >↓</button>
                      <button
                        type="button"
                        onClick={() => toggleSource(id)}
                        className="px-1 text-red-400 hover:text-red-300"
                        aria-label="Remove"
                      >×</button>
                    </div>
                  </div>
                );
              })}
              {/* Unselected sources */}
              {eligibleSources
                .filter((a) => !sourceAccountIds.includes(a.id))
                .map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => toggleSource(a.id)}
                    className="flex w-full items-center justify-between rounded border border-gray-700 bg-gray-900 px-2 py-1 text-left text-xs text-gray-300 hover:border-gray-600 hover:text-gray-100"
                  >
                    <span>
                      {a.name}{" "}
                      <span className="text-[10px] text-gray-500">({a.subType})</span>
                    </span>
                    <span className="text-accent">+ Add</span>
                  </button>
                ))}
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
            disabled={submitting || rothAccounts.length === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
