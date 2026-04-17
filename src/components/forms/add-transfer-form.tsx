"use client";

import { useState, FormEvent } from "react";

interface ScheduleRow {
  id: string;
  year: number;
  amount: string;
}

interface AddTransferFormProps {
  clientId: string;
  accounts: { id: string; name: string; category: string; subType: string }[];
  initialData?: {
    id: string;
    name: string;
    sourceAccountId: string;
    targetAccountId: string;
    amount: string;
    mode: "one_time" | "recurring" | "scheduled";
    startYear: number;
    startYearRef: string | null;
    endYear: number | null;
    endYearRef: string | null;
    growthRate: string;
    schedules: { id: string; year: number; amount: string }[];
  };
  onClose: () => void;
  onSaved: () => void;
}

const INPUT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECT_CLASS =
  "mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none";

function getTransferTaxLabel(
  sourceCategory: string,
  sourceSubType: string,
  targetCategory: string,
  targetSubType: string,
): { label: string; color: string } {
  const taxDeferred = ["traditional_ira", "401k"];
  const roth = ["roth_ira", "roth_401k"];

  if (sourceCategory === "retirement" && targetCategory === "retirement") {
    if (taxDeferred.includes(sourceSubType) && roth.includes(targetSubType)) {
      return { label: "Roth Conversion — Taxable", color: "text-amber-400" };
    }
    return { label: "Tax-Free Rollover", color: "text-green-400" };
  }
  if (sourceCategory === "retirement") {
    return { label: "Distribution — Taxable", color: "text-red-400" };
  }
  if (sourceCategory === "taxable" || sourceCategory === "cash") {
    return { label: "Liquidation", color: "text-gray-400" };
  }
  return { label: "Transfer", color: "text-gray-400" };
}

function makeId(): string {
  return Math.random().toString(36).slice(2);
}

export default function AddTransferForm({
  clientId,
  accounts,
  initialData,
  onClose,
  onSaved,
}: AddTransferFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [sourceAccountId, setSourceAccountId] = useState(
    initialData?.sourceAccountId ?? (accounts[0]?.id ?? ""),
  );
  const [targetAccountId, setTargetAccountId] = useState(
    initialData?.targetAccountId ?? (accounts[0]?.id ?? ""),
  );
  const [amount, setAmount] = useState(initialData?.amount ?? "");
  const [mode, setMode] = useState<"one_time" | "recurring" | "scheduled">(
    initialData?.mode ?? "one_time",
  );
  const [startYear, setStartYear] = useState(
    initialData?.startYear ?? new Date().getFullYear(),
  );
  const [endYear, setEndYear] = useState<number>(
    initialData?.endYear ?? new Date().getFullYear() + 1,
  );
  const [growthRate, setGrowthRate] = useState(
    initialData ? (parseFloat(initialData.growthRate) * 100).toString() : "0",
  );
  const [scheduleRows, setScheduleRows] = useState<ScheduleRow[]>(
    initialData?.schedules.map((s) => ({
      id: s.id,
      year: s.year,
      amount: s.amount,
    })) ?? [],
  );
  const [submitting, setSubmitting] = useState(false);

  const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
  const targetAccount = accounts.find((a) => a.id === targetAccountId);

  const taxLabel =
    sourceAccount && targetAccount
      ? getTransferTaxLabel(
          sourceAccount.category,
          sourceAccount.subType,
          targetAccount.category,
          targetAccount.subType,
        )
      : null;

  function addScheduleRow() {
    setScheduleRows((rows) => [
      ...rows,
      { id: makeId(), year: startYear, amount: "" },
    ]);
  }

  function removeScheduleRow(id: string) {
    setScheduleRows((rows) => rows.filter((r) => r.id !== id));
  }

  function updateScheduleRow(id: string, field: "year" | "amount", value: string) {
    setScheduleRows((rows) =>
      rows.map((r) =>
        r.id === id
          ? { ...r, [field]: field === "year" ? Number(value) : value }
          : r,
      ),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body = {
        name,
        sourceAccountId,
        targetAccountId,
        amount: parseFloat(amount) || 0,
        mode,
        startYear,
        endYear: mode !== "one_time" ? endYear : null,
        startYearRef: null,
        endYearRef: null,
        growthRate: mode === "recurring" ? parseFloat(growthRate) / 100 || 0 : 0,
        schedules:
          mode === "scheduled"
            ? scheduleRows.map((s) => ({
                year: s.year,
                amount: parseFloat(s.amount) || 0,
              }))
            : [],
      };

      const url = initialData
        ? `/api/clients/${clientId}/transfers`
        : `/api/clients/${clientId}/transfers`;
      const method = initialData ? "PUT" : "POST";
      const fetchBody = initialData
        ? JSON.stringify({ transferId: initialData.id, ...body })
        : JSON.stringify(body);

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: fetchBody,
      });

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
        className="w-full max-w-lg space-y-3 rounded-xl border border-gray-700 bg-gray-900 p-5 shadow-xl"
        style={{ maxHeight: "90vh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-100">
            {initialData ? "Edit Transfer" : "Add Transfer"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xl text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., IRA to Roth conversion"
            required
            className={INPUT_CLASS}
          />
        </div>

        {/* Source / Target accounts */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400">Source account</label>
            <select
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
              className={SELECT_CLASS}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">Target account</label>
            <select
              value={targetAccountId}
              onChange={(e) => setTargetAccountId(e.target.value)}
              className={SELECT_CLASS}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tax classification badge */}
        {taxLabel && (
          <p className={`text-xs font-medium ${taxLabel.color}`}>
            {taxLabel.label}
          </p>
        )}

        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-gray-400">Amount ($)</label>
          <input
            type="number"
            step="1"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className={INPUT_CLASS}
          />
        </div>

        {/* Mode */}
        <div>
          <label className="block text-xs font-medium text-gray-400">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "one_time" | "recurring" | "scheduled")}
            className={SELECT_CLASS}
          >
            <option value="one_time">One-Time</option>
            <option value="recurring">Recurring</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </div>

        {/* Start year (always shown) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400">Start year</label>
            <input
              type="number"
              min={2000}
              max={2100}
              value={startYear}
              onChange={(e) => setStartYear(Number(e.target.value))}
              required
              className={INPUT_CLASS}
            />
          </div>

          {/* End year — recurring and scheduled only */}
          {(mode === "recurring" || mode === "scheduled") && (
            <div>
              <label className="block text-xs font-medium text-gray-400">End year</label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                required
                className={INPUT_CLASS}
              />
            </div>
          )}
        </div>

        {/* Growth rate — recurring only */}
        {mode === "recurring" && (
          <div>
            <label className="block text-xs font-medium text-gray-400">
              Growth rate (% / yr)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={growthRate}
              onChange={(e) => setGrowthRate(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        )}

        {/* Schedule grid — scheduled only */}
        {mode === "scheduled" && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-medium text-gray-400">Schedule</label>
              <button
                type="button"
                onClick={addScheduleRow}
                className="rounded px-2 py-0.5 text-xs text-blue-400 hover:text-blue-300"
              >
                + Add row
              </button>
            </div>
            {scheduleRows.length === 0 ? (
              <p className="text-xs text-gray-500">No rows yet. Click Add row to add one.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pb-1 pr-2 font-medium">Year</th>
                    <th className="pb-1 pr-2 font-medium">Amount ($)</th>
                    <th className="pb-1 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row) => (
                    <tr key={row.id}>
                      <td className="pr-2 pb-1">
                        <input
                          type="number"
                          min={2000}
                          max={2100}
                          value={row.year}
                          onChange={(e) => updateScheduleRow(row.id, "year", e.target.value)}
                          className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pr-2 pb-1">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={row.amount}
                          onChange={(e) => updateScheduleRow(row.id, "amount", e.target.value)}
                          className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="pb-1">
                        <button
                          type="button"
                          onClick={() => removeScheduleRow(row.id)}
                          className="text-xs text-red-400 hover:text-red-300"
                          aria-label="Remove row"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200"
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
