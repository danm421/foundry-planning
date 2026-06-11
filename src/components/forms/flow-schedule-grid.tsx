"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";
import { fillFlat, fillGrowth, type ScheduleEntry } from "@/lib/schedule-utils";

/** Exposed to parent so the dialog footer can drive the save action. */
export interface ScheduleSaveBinding {
  save: () => Promise<{ ok: true } | { ok: false; error: string }>;
  saving: boolean;
  /** True when the grid has unsaved edits since the last successful save / initial load. */
  isDirty: boolean;
}

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

/**
 * Discriminates the save target. Entity targets save against the legacy
 * entity_flow_overrides route; account targets hit the parallel account
 * route added in business-account-flow-schedule Phase 3. The kind also drives
 * the Distribution-% column rule:
 *   entity → only business entity types (LLC, partnership, S-corp, etc.)
 *   account → always shown (top-level business accounts only — enforced upstream)
 */
export type ScheduleTarget =
  | { kind: "entity"; entityId: string; entityType: EntityType }
  | { kind: "account"; accountId: string };

export interface FlowScheduleGridOverride {
  year: number;
  incomeAmount: number | null;
  expenseAmount: number | null;
  distributionPercent: number | null;
}

export interface FlowScheduleGridProps {
  clientId: string;
  target: ScheduleTarget;
  /** Null = base-plan overrides (scenario_id IS NULL). */
  scenarioId: string | null;
  planStartYear: number;
  planEndYear: number;
  primaryClientBirthYear: number;
  /**
   * Income/expense baseline used to render the per-year placeholder.
   * Single flow for entity targets (one income + one expense per entity);
   * array for account targets (a business may own N incomes and N expenses
   * — the placeholder shows the summed annual+growth across all of them).
   */
  income: BaseFlow | BaseFlow[] | null;
  expense: BaseFlow | BaseFlow[] | null;
  initialOverrides: FlowScheduleGridOverride[];
  /** Lifts save + saving state to the parent so the dialog footer can render the button. */
  onSaveBindingChange?: (binding: ScheduleSaveBinding | null) => void;
}

const isBusinessType = (t: EntityType) => t !== "trust" && t !== "foundation";

function baseAmountSingle(row: BaseFlow, year: number): number {
  if (year < row.startYear || year > row.endYear) return 0;
  const inflateFrom = row.inflationStartYear ?? row.startYear;
  return row.annualAmount * Math.pow(1 + row.growthRate, year - inflateFrom);
}

function baseAmount(row: BaseFlow | BaseFlow[] | null, year: number): number {
  if (!row) return 0;
  if (Array.isArray(row)) {
    let total = 0;
    for (const r of row) total += baseAmountSingle(r, year);
    return total;
  }
  return baseAmountSingle(row, year);
}

type Cell = string; // "" = no override; otherwise the typed string

function cellsEqual(a: Record<number, Cell>, b: Record<number, Cell>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k as unknown as number] !== b[k as unknown as number]) return false;
  }
  return true;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function showDistColumn(target: ScheduleTarget): boolean {
  return target.kind === "account" || isBusinessType(target.entityType);
}

function buildSaveUrl(clientId: string, target: ScheduleTarget, scenarioId: string | null): string {
  const path =
    target.kind === "entity"
      ? `/api/clients/${clientId}/entities/${target.entityId}/flow-overrides`
      : `/api/clients/${clientId}/accounts/${target.accountId}/flow-overrides`;
  return scenarioId ? `${path}?scenarioId=${scenarioId}` : path;
}

export default function FlowScheduleGrid(props: FlowScheduleGridProps) {
  const showDist = showDistColumn(props.target);
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = props.planStartYear; y <= props.planEndYear; y++) out.push(y);
    return out;
  }, [props.planStartYear, props.planEndYear]);

  // State: per-year cells. Empty string = no override; otherwise the user's typed value.
  const initialIncome = useMemo(() => {
    const out: Record<number, Cell> = {};
    for (const o of props.initialOverrides) {
      if (o.incomeAmount != null) out[o.year] = String(o.incomeAmount);
    }
    return out;
  }, [props.initialOverrides]);
  const initialExpense = useMemo(() => {
    const out: Record<number, Cell> = {};
    for (const o of props.initialOverrides) {
      if (o.expenseAmount != null) out[o.year] = String(o.expenseAmount);
    }
    return out;
  }, [props.initialOverrides]);
  const initialDist = useMemo(() => {
    const out: Record<number, Cell> = {};
    for (const o of props.initialOverrides) {
      if (o.distributionPercent != null)
        out[o.year] = String((o.distributionPercent * 100).toFixed(2));
    }
    return out;
  }, [props.initialOverrides]);

  const [income, setIncome] = useState<Record<number, Cell>>(initialIncome);
  const [expense, setExpense] = useState<Record<number, Cell>>(initialExpense);
  const [dist, setDist] = useState<Record<number, Cell>>(initialDist);
  // Snapshot of last-saved cell state; isDirty is the diff against this.
  const [savedSnapshot, setSavedSnapshot] = useState({
    income: initialIncome,
    expense: initialExpense,
    dist: initialDist,
  });

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(
    () =>
      !cellsEqual(income, savedSnapshot.income) ||
      !cellsEqual(expense, savedSnapshot.expense) ||
      !cellsEqual(dist, savedSnapshot.dist),
    [income, expense, dist, savedSnapshot],
  );

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

  async function handleSave(): Promise<{ ok: true } | { ok: false; error: string }> {
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
      const url = buildSaveUrl(props.clientId, props.target, props.scenarioId);
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
      setSavedSnapshot({ income, expense, dist });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }

  // Stable callback for the parent: invokes the latest handleSave via ref so we
  // don't re-fire the registration effect on every keystroke.
  const handleSaveRef = useRef<typeof handleSave>(() =>
    Promise.resolve({ ok: true as const }),
  );
  handleSaveRef.current = handleSave;
  const stableSave = useCallback(() => handleSaveRef.current(), []);

  const onSaveBindingChange = props.onSaveBindingChange;
  useEffect(() => {
    onSaveBindingChange?.({ save: stableSave, saving, isDirty });
  }, [onSaveBindingChange, stableSave, saving, isDirty]);
  useEffect(
    () => () => onSaveBindingChange?.(null),
    [onSaveBindingChange],
  );

  const qfLabelClass = "flex flex-col gap-0.5 text-[11px] font-semibold text-ink";
  const qfNumberInputClass =
    "rounded border border-hair bg-card-2 px-2 py-1 text-xs text-ink";
  const thClass =
    "sticky top-0 z-10 border-b border-hair bg-card-2 py-2 text-right text-[13px] font-semibold text-ink";
  const distSetButtonClass =
    "rounded border border-hair bg-card-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink hover:bg-card-hover";

  return (
    <section className="space-y-2 rounded-md border border-hair bg-card-2 p-4">
      <p className="text-xs text-ink-3">
        Override individual years. Blank cells resolve to $0 in schedule mode.
        {savedAt && !saving && (
          <span className="ml-2 text-ink-2">
            · Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
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
            className="rounded-md border border-hair bg-card-2 px-3 py-1 text-xs font-medium text-ink-2 hover:bg-card-hover hover:text-ink"
          >
            Apply
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
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
    </section>
  );
}
