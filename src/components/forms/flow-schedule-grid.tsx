"use client";

import { useState, useMemo } from "react";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";

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
  open: boolean;
  onClose: () => void;
  clientId: string;
  entityId: string;
  entityName: string;
  entityType: EntityType;
  scenarioId: string;
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
  const [error, setError] = useState<string | null>(null);

  if (!props.open) return null;

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
      const res = await fetch(
        `/api/clients/${props.clientId}/entities/${props.entityId}/flow-overrides?scenarioId=${props.scenarioId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Failed to save");
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-md border border-hair bg-card-2 p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-1">Schedule — {props.entityName}</h2>
          <button
            type="button"
            onClick={props.onClose}
            className="text-xs text-ink-3 hover:text-ink-1"
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-ink-3">
          Override individual years. Blank cells use the base value with growth applied.
        </p>
        {error && (
          <p className="mb-2 rounded bg-red-900/50 px-3 py-2 text-xs text-red-400">{error}</p>
        )}

        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-card-2">
              <tr className="border-b border-hair">
                <th className="py-2 text-left font-medium text-ink-3">Year (Age)</th>
                <th className="py-2 text-right font-medium text-ink-3">Income</th>
                <th className="py-2 text-right font-medium text-ink-3">Expense</th>
                {showDist && (
                  <th className="py-2 text-right font-medium text-ink-3">Distribution %</th>
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
                    <td className="py-1.5 text-ink-2">
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

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-hair px-3 py-1.5 text-xs text-ink-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
