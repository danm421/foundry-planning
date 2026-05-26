"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MoneyText from "@/components/money-text";
import { fieldLabelClassName } from "@/components/forms/input-styles";
import { PercentInput } from "@/components/percent-input";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useScenarioState } from "@/hooks/use-scenario-state";
import type { EntityFlowMode } from "@/engine/types";
import FlowScheduleGrid, {
  type FlowScheduleGridOverride,
  type ScheduleSaveBinding,
} from "@/components/forms/flow-schedule-grid";

/** Owned-flow row with optional schedule-baseline fields. */
export interface BusinessFlowRow {
  id: string;
  name: string;
  annualAmount: number | string;
  ownerAccountId?: string | null;
  /** Schedule-grid baseline fields (optional — falls back to 0 placeholder if absent). */
  startYear?: number | null;
  endYear?: number | null;
  growthRate?: number | null;
  inflationStartYear?: number | null;
}

const TAX_TREATMENTS = ["qbi", "ordinary", "non_taxable"] as const;
export type BusinessTaxTreatment = (typeof TAX_TREATMENTS)[number];

export interface BusinessFlowsTabProps {
  clientId: string;
  businessId: string;
  incomes: BusinessFlowRow[];
  expenses: BusinessFlowRow[];
  hidden: boolean;
  /** When undefined we hide the Annual ↔ Schedule toggle (read-only mode). */
  flowMode?: EntityFlowMode;
  /** Schedule-grid context — required when flowMode is provided. */
  planStartYear?: number;
  planEndYear?: number;
  primaryClientBirthYear?: number;
  /** Editable business-only fields (Annual mode). */
  distributionPolicyPercent?: number | null;
  taxTreatment?: BusinessTaxTreatment;
  /** Pre-loaded overrides for the schedule grid. */
  initialFlowOverrides?: FlowScheduleGridOverride[];
  /** Lifts the schedule grid's save handler so the dialog footer can drive saves. */
  onScheduleSaveBindingChange?: (binding: ScheduleSaveBinding | null) => void;
  /** Lifts the annual-mode Distribution & Tax save handler to the dialog footer. */
  onAnnualSaveBindingChange?: (binding: ScheduleSaveBinding | null) => void;
  onOpenAddIncome: () => void;
  onOpenAddExpense: () => void;
  onEditIncome: (id: string) => void;
  onEditExpense: (id: string) => void;
}

const toNum = (v: number | string): number =>
  typeof v === "number" ? v : parseFloat(v || "0") || 0;

/**
 * Convert a business-owned flow row into the BaseFlow shape FlowScheduleGrid
 * expects for placeholder calculation. Returns null when the row is missing
 * the schedule fields — callers (host pages) may pass only the lean shape.
 */
function toBaseFlow(row: BusinessFlowRow) {
  if (row.startYear == null || row.endYear == null || row.growthRate == null) {
    return null;
  }
  return {
    annualAmount: toNum(row.annualAmount),
    growthRate: row.growthRate,
    startYear: row.startYear,
    endYear: row.endYear,
    inflationStartYear: row.inflationStartYear ?? null,
  };
}

export default function BusinessFlowsTab({
  clientId,
  businessId,
  incomes,
  expenses,
  hidden,
  flowMode,
  planStartYear,
  planEndYear,
  primaryClientBirthYear,
  distributionPolicyPercent,
  taxTreatment,
  initialFlowOverrides,
  onScheduleSaveBindingChange,
  onAnnualSaveBindingChange,
  onOpenAddIncome,
  onOpenAddExpense,
  onEditIncome,
  onEditExpense,
}: BusinessFlowsTabProps) {
  const writer = useScenarioWriter(clientId);
  const { scenarioId } = useScenarioState(clientId);

  const [mode, setMode] = useState<EntityFlowMode>(flowMode ?? "annual");
  const [modeError, setModeError] = useState<string | null>(null);

  // Keep local state in sync if the dialog reopens with a different business.
  useEffect(() => {
    if (flowMode) setMode(flowMode);
  }, [flowMode]);

  // Clear schedule-save binding when leaving schedule mode.
  useEffect(() => {
    if (mode !== "schedule") onScheduleSaveBindingChange?.(null);
  }, [mode, onScheduleSaveBindingChange]);

  // Clear annual-save binding when leaving annual mode.
  useEffect(() => {
    if (mode !== "annual") onAnnualSaveBindingChange?.(null);
  }, [mode, onAnnualSaveBindingChange]);

  const ownedIncomes = incomes.filter((i) => i.ownerAccountId === businessId);
  const ownedExpenses = expenses.filter((e) => e.ownerAccountId === businessId);

  const netAnnual =
    ownedIncomes.reduce((s, i) => s + toNum(i.annualAmount), 0) -
    ownedExpenses.reduce((s, e) => s + toNum(e.annualAmount), 0);

  async function handleModeChange(next: EntityFlowMode) {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    setModeError(null);
    try {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: "account",
          targetId: businessId,
          desiredFields: { flowMode: next },
        },
        {
          url: `/api/clients/${clientId}/accounts/${businessId}`,
          method: "PUT",
          body: { flowMode: next },
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Failed to switch mode");
      }
    } catch (err) {
      setMode(previous);
      setModeError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const showToggle =
    flowMode !== undefined &&
    planStartYear !== undefined &&
    planEndYear !== undefined &&
    primaryClientBirthYear !== undefined;

  const isSchedule = mode === "schedule";

  return (
    <div className={hidden ? "hidden" : "space-y-4"}>
      {showToggle && (
        <div className="inline-flex rounded-md border border-hair bg-card p-0.5 text-xs">
          <button
            type="button"
            onClick={() => handleModeChange("annual")}
            className={
              "rounded px-3 py-1 font-medium transition " +
              (mode === "annual"
                ? "bg-accent text-accent-on"
                : "text-ink-2 hover:text-ink")
            }
          >
            Annual + growth
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("schedule")}
            className={
              "rounded px-3 py-1 font-medium transition " +
              (mode === "schedule"
                ? "bg-accent text-accent-on"
                : "text-ink-2 hover:text-ink")
            }
          >
            Custom schedule
          </button>
        </div>
      )}

      {modeError && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-xs text-red-400">{modeError}</p>
      )}

      {showToggle && isSchedule ? (
        <FlowScheduleGrid
          clientId={clientId}
          target={{ kind: "account", accountId: businessId }}
          scenarioId={scenarioId}
          planStartYear={planStartYear!}
          planEndYear={planEndYear!}
          primaryClientBirthYear={primaryClientBirthYear!}
          income={ownedIncomes
            .map(toBaseFlow)
            .filter((b): b is NonNullable<ReturnType<typeof toBaseFlow>> => b !== null)}
          expense={ownedExpenses
            .map(toBaseFlow)
            .filter((b): b is NonNullable<ReturnType<typeof toBaseFlow>> => b !== null)}
          initialOverrides={initialFlowOverrides ?? []}
          onSaveBindingChange={onScheduleSaveBindingChange}
        />
      ) : (
        <>
          <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
            <span className="text-[12px] font-medium text-ink-3 uppercase tracking-wider">
              Net annual flow
            </span>
            <MoneyText value={netAnnual} className="text-[15px] font-semibold text-ink" />
          </div>

          <FlowList
            heading="Incomes"
            rows={ownedIncomes}
            emptyText="No incomes for this business."
            addLabel="+ Add income"
            onAdd={onOpenAddIncome}
            onEdit={onEditIncome}
            sign="positive"
          />

          <FlowList
            heading="Expenses"
            rows={ownedExpenses}
            emptyText="No expenses for this business."
            addLabel="+ Add expense"
            onAdd={onOpenAddExpense}
            onEdit={onEditExpense}
            sign="negative"
          />

          {flowMode !== undefined && (
            <DistributionAndTaxSection
              clientId={clientId}
              businessId={businessId}
              writer={writer}
              distributionPolicyPercent={distributionPolicyPercent ?? null}
              taxTreatment={taxTreatment ?? "qbi"}
              onSaveBindingChange={onAnnualSaveBindingChange}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Income/Expense list ──────────────────────────────────────────────────────

function FlowList({
  heading,
  rows,
  emptyText,
  addLabel,
  onAdd,
  onEdit,
  sign,
}: {
  heading: string;
  rows: BusinessFlowRow[];
  emptyText: string;
  addLabel: string;
  onAdd: () => void;
  onEdit: (id: string) => void;
  sign: "positive" | "negative";
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className={fieldLabelClassName}>{heading}</label>
        <button
          type="button"
          onClick={onAdd}
          className="text-[12px] text-accent hover:text-accent-deep font-medium"
        >
          {addLabel}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-ink-4 py-2">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2"
            >
              <button
                type="button"
                onClick={() => onEdit(r.id)}
                className="flex-1 min-w-0 text-left text-[13px] text-ink truncate hover:underline"
              >
                {r.name}
              </button>
              <span
                className={
                  "text-[12px] tabular-nums " +
                  (sign === "negative" ? "text-crit" : "text-ink-2")
                }
              >
                {sign === "negative" ? (
                  <>
                    (<MoneyText value={toNum(r.annualAmount)} />)
                  </>
                ) : (
                  <MoneyText value={toNum(r.annualAmount)} />
                )}{" "}
                / yr
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Distribution & Tax ─────────────────────────────────────────────────────

function DistributionAndTaxSection({
  clientId,
  businessId,
  writer,
  distributionPolicyPercent,
  taxTreatment,
  onSaveBindingChange,
}: {
  clientId: string;
  businessId: string;
  writer: ReturnType<typeof useScenarioWriter>;
  distributionPolicyPercent: number | null;
  taxTreatment: BusinessTaxTreatment;
  onSaveBindingChange?: (binding: ScheduleSaveBinding | null) => void;
}) {
  const initialPct =
    distributionPolicyPercent != null
      ? String((distributionPolicyPercent * 100).toFixed(2))
      : "";
  const [pct, setPct] = useState(initialPct);
  const [tx, setTx] = useState<BusinessTaxTreatment>(taxTreatment);
  const [savedPct, setSavedPct] = useState(initialPct);
  const [savedTx, setSavedTx] = useState<BusinessTaxTreatment>(taxTreatment);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDirty = pct !== savedPct || tx !== savedTx;

  async function save(): Promise<{ ok: true } | { ok: false; error: string }> {
    setSaving(true);
    setError(null);
    try {
      const desiredFields = {
        distributionPolicyPercent:
          pct.trim() === "" ? null : Number(pct) / 100,
        businessTaxTreatment: tx,
      };
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: "account",
          targetId: businessId,
          desiredFields,
        },
        {
          url: `/api/clients/${clientId}/accounts/${businessId}`,
          method: "PUT",
          body: desiredFields,
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Failed to save");
      }
      setSavedPct(pct);
      setSavedTx(tx);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }

  // Expose save handler to the parent dialog footer. Mirrors FlowScheduleGrid:
  // ref-route the latest closure so re-registration doesn't fire on every keystroke.
  const saveRef = useRef<typeof save>(save);
  saveRef.current = save;
  const stableSave = useCallback(() => saveRef.current(), []);
  useEffect(() => {
    onSaveBindingChange?.({ save: stableSave, saving, isDirty });
  }, [onSaveBindingChange, stableSave, saving, isDirty]);
  useEffect(
    () => () => onSaveBindingChange?.(null),
    [onSaveBindingChange],
  );

  return (
    <section className="space-y-3 rounded-md border border-hair bg-card-2 p-4">
      <h3 className="text-sm font-semibold text-ink-2">Distributions &amp; taxes</h3>
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      <div>
        <label className={fieldLabelClassName} htmlFor="business-dist-pct">
          Distribution policy (% of net income to owners)
        </label>
        <PercentInput id="business-dist-pct" value={pct} onChange={setPct} />
      </div>

      <div>
        <span className={fieldLabelClassName}>Tax treatment</span>
        <div className="mt-1 flex gap-1.5">
          {TAX_TREATMENTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setTx(v)}
              className={
                "rounded-md border px-2 py-1 text-xs font-medium " +
                (tx === v
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-hair bg-card text-ink-3 hover:text-ink-2")
              }
            >
              {v === "qbi" ? "QBI" : v === "ordinary" ? "Ordinary" : "Non-taxable"}
            </button>
          ))}
        </div>
      </div>

    </section>
  );
}
