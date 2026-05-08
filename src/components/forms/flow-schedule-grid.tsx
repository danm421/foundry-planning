"use client";

import { useState, useMemo } from "react";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";
import { fillFlat, fillGrowth, type ScheduleEntry } from "@/lib/schedule-utils";

type EntityType =
  | "trust"
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "foundation"
  | "other";

interface BaseFlow {
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  inflationStartYear: number | null;
}

export interface FlowScheduleGridOverride {
  year: number;
  incomeAmount: number | null;
  expenseAmount: number | null;
  distributionPercent: number | null;
}

export interface FlowScheduleGridProps {
  clientId: string;
  entityId: string;
  entityType: EntityType;
  /** Null = base-plan overrides (scenario_id IS NULL). */
  scenarioId: string | null;
  planStartYear: number;
  planEndYear: number;
  primaryClientBirthYear: number;
  income: BaseFlow | null;
  expense: BaseFlow | null;
  initialOverrides: FlowScheduleGridOverride[];
}

const isBusinessType = (t: EntityType) => t !== "trust" && t !== "foundation";

function baseAmount(row: BaseFlow | null, year: number): number {
  if (!row) return 0;
  if (year < row.startYear || year > row.endYear) return 0;
  const inflateFrom = row.inflationStartYear ?? row.startYear;
  return row.annualAmount * Math.pow(1 + row.growthRate, year - inflateFrom);
}

type Cell = string; // "" = no override; otherwise the typed string

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function FlowScheduleGrid(props: FlowScheduleGridProps) {
  const showDist = isBusinessType(props.entityType);
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = props.planStartYear; y <= props.planEndYear; y++) out.push(y);
    return out;
  }, [props.planStartYear, props.planEndYear]);

  // State: per-year cells. Empty string = no override; otherwise the user's typed value.
  const [income, setIncome] = useState<Record<number, Cell>>(() => {
    const out: Record<number, Cell> = {};
    for (const o of props.initialOverrides) {
      if (o.incomeAmount != null) out[o.year] = String(o.incomeAmount);
    }
    return out;
  });
  const [expense, setExpense] = useState<Record<number, Cell>>(() => {
    const out: Record<number, Cell> = {};
    for (const o of props.initialOverrides) {
      if (o.expenseAmount != null) out[o.year] = String(o.expenseAmount);
    }
    return out;
  });
  const [dist, setDist] = useState<Record<number, Cell>>(() => {
    const out: Record<number, Cell> = {};
    for (const o of props.initialOverrides) {
      if (o.distributionPercent != null)
        out[o.year] = String((o.distributionPercent * 100).toFixed(2));
    }
    return out;
  });

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Quick-fill panel state
  const [qfStart, setQfStart] = useState<string>(String(props.planStartYear));
  const [qfEnd, setQfEnd] = useState<string>(String(props.planEndYear));
  const [qfIncome, setQfIncome] = useState<string>("");
  const [qfExpense, setQfExpense] = useState<string>("");
  const [qfDist, setQfDist] = useState<string>("");
  const [qfGrowth, setQfGrowth] = useState<string>("");

  function applyEntries(
    setter: React.Dispatch<React.SetStateAction<Record<number, Cell>>>,
    entries: ScheduleEntry[],
    format: (n: number) => string,
  ) {
    setter((prev) => {
      const next = { ...prev };
      for (const e of entries) next[e.year] = format(e.amount);
      return next;
    });
  }

  function applyQuickFill() {
    const start = parseInt(qfStart, 10);
    const end = parseInt(qfEnd, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    const incBase = qfIncome.trim() === "" ? null : Number(qfIncome);
    const expBase = qfExpense.trim() === "" ? null : Number(qfExpense);
    const distVal = qfDist.trim() === "" ? null : Number(qfDist);
    const growthPct = qfGrowth.trim() === "" ? 0 : Number(qfGrowth) / 100;
    if (incBase == null && expBase == null && distVal == null) return;

    const intStr = (n: number) => String(Math.round(n));
    if (incBase != null) applyEntries(setIncome, fillGrowth(start, end, incBase, growthPct), intStr);
    if (expBase != null) applyEntries(setExpense, fillGrowth(start, end, expBase, growthPct), intStr);
    if (distVal != null) applyEntries(setDist, fillFlat(start, end, distVal), String);
  }

  function setDistAll(percent: number) {
    applyEntries(setDist, fillFlat(props.planStartYear, props.planEndYear, percent), String);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const overrides: FlowScheduleGridOverride[] = [];
    for (const y of years) {
      const i = income[y]?.trim();
      const e = expense[y]?.trim();
      const d = dist[y]?.trim();
      const row: FlowScheduleGridOverride = {
        year: y,
        incomeAmount: i ? Number(i) : null,
        expenseAmount: e ? Number(e) : null,
        distributionPercent: d ? Number(d) / 100 : null,
      };
      if (
        row.incomeAmount != null ||
        row.expenseAmount != null ||
        row.distributionPercent != null
      ) {
        overrides.push(row);
      }
    }
    try {
      const url = props.scenarioId
        ? `/api/clients/${props.clientId}/entities/${props.entityId}/flow-overrides?scenarioId=${props.scenarioId}`
        : `/api/clients/${props.clientId}/entities/${props.entityId}/flow-overrides`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Failed to save");
      }
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  const qfLabelClass = "flex flex-col gap-0.5 text-[11px] font-semibold text-ink";
  const qfNumberInputClass =
    "rounded border border-hair bg-card-2 px-2 py-1 text-xs text-ink";
  const thClass = "py-2 text-right text-[13px] font-semibold text-ink";
  const distSetButtonClass =
    "rounded border border-hair bg-card-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink hover:bg-card";

  return (
    <section className="space-y-3 rounded-md border border-hair bg-card-2 p-4">
      <p className="text-xs text-ink-3">
        Override individual years. Blank cells resolve to $0 in schedule mode.
      </p>

      {/* Quick fill */}
      <div className="rounded-md border border-hair bg-card p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Quick fill
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <label className={qfLabelClass}>
            Start year
            <input
              type="number"
              value={qfStart}
              onChange={(e) => setQfStart(e.target.value)}
              className={qfNumberInputClass}
            />
          </label>
          <label className={qfLabelClass}>
            End year
            <input
              type="number"
              value={qfEnd}
              onChange={(e) => setQfEnd(e.target.value)}
              className={qfNumberInputClass}
            />
          </label>
          <label className={qfLabelClass}>
            Income
            <CurrencyInput value={qfIncome} onChange={setQfIncome} placeholder="—" />
          </label>
          <label className={qfLabelClass}>
            Expense
            <CurrencyInput value={qfExpense} onChange={setQfExpense} placeholder="—" />
          </label>
          {showDist && (
            <label className={qfLabelClass}>
              Distribution %
              <PercentInput value={qfDist} onChange={setQfDist} placeholder="—" />
            </label>
          )}
          <label className={qfLabelClass}>
            Growth %
            <PercentInput value={qfGrowth} onChange={setQfGrowth} placeholder="0" />
          </label>
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={applyQuickFill}
            className="rounded-md border border-hair bg-card-2 px-3 py-1 text-xs font-medium text-ink-2 hover:bg-card hover:text-ink"
          >
            Apply
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      <div className="max-h-[60vh] overflow-y-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-card-2">
            <tr className="border-b border-hair">
              <th className={thClass + " text-left"}>Year (Age)</th>
              <th className={thClass}>Income</th>
              <th className={thClass}>Expense</th>
              {showDist && (
                <th className={thClass}>
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Distribution %</span>
                    <button
                      type="button"
                      onClick={() => setDistAll(0)}
                      className={distSetButtonClass}
                      title="Set every year to 0%"
                    >
                      0%
                    </button>
                    <button
                      type="button"
                      onClick={() => setDistAll(100)}
                      className={distSetButtonClass}
                      title="Set every year to 100%"
                    >
                      100%
                    </button>
                  </div>
                </th>
              )}
            </tr>
          </thead>
            <tbody>
              {years.map((y) => {
                const age = y - props.primaryClientBirthYear;
                const incBase = baseAmount(props.income, y);
                const expBase = baseAmount(props.expense, y);
                return (
                  <tr key={y} className="border-b border-hair/50">
                    <td className="py-1.5 text-ink">
                      {y} (Age {age})
                    </td>
                    <td className="py-1.5">
                      <CurrencyInput
                        value={income[y] ?? ""}
                        onChange={(v) => setIncome((s) => ({ ...s, [y]: v }))}
                        placeholder={fmtMoney(incBase)}
                      />
                    </td>
                    <td className="py-1.5">
                      <CurrencyInput
                        value={expense[y] ?? ""}
                        onChange={(v) => setExpense((s) => ({ ...s, [y]: v }))}
                        placeholder={fmtMoney(expBase)}
                      />
                    </td>
                    {showDist && (
                      <td className="py-1.5">
                        <PercentInput
                          value={dist[y] ?? ""}
                          onChange={(v) => setDist((s) => ({ ...s, [y]: v }))}
                          placeholder="—"
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      <div className="flex items-center justify-end gap-3">
        {savedAt && !saving && (
          <span className="text-[11px] text-ink-3">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save schedule"}
        </button>
      </div>
    </section>
  );
}
