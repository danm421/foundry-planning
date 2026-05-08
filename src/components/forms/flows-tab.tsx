"use client";

import { useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { CurrencyInput } from "../currency-input";
import { PercentInput } from "../percent-input";
import { inputClassName, fieldLabelClassName } from "./input-styles";

type EntityType =
  | "trust"
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "foundation"
  | "other";

export interface FlowsTabIncome {
  id: string;
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  growthSource: "inflation" | "custom";
  inflationStartYear: number | null;
}

export type FlowsTabExpense = FlowsTabIncome;

export interface FlowsTabProps {
  clientId: string;
  entityId: string;
  entityName: string;
  entityType: EntityType;
  income: FlowsTabIncome | null;
  expense: FlowsTabExpense | null;
  distributionPolicyPercent: number | null;
  taxTreatment: "qbi" | "ordinary" | "non_taxable";
  planStartYear: number;
  defaultEndYear: number;
}

const isBusinessType = (t: EntityType) => t !== "trust" && t !== "foundation";

const formatCurrency = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

export default function FlowsTab(props: FlowsTabProps) {
  const writer = useScenarioWriter(props.clientId);

  return (
    <div className="space-y-6">
      <FlowCard kind="income" {...props} writer={writer} />
      <FlowCard kind="expense" {...props} writer={writer} />
      {isBusinessType(props.entityType) && (
        <DistributionAndTaxSection {...props} />
      )}
    </div>
  );
}

// ── Income/Expense card ──────────────────────────────────────────────────────

type WriterShape = ReturnType<typeof useScenarioWriter>;

function FlowCard({
  kind,
  income,
  expense,
  entityName,
  entityId,
  clientId,
  planStartYear,
  defaultEndYear,
  writer,
}: FlowsTabProps & { kind: "income" | "expense"; writer: WriterShape }) {
  const existing = kind === "income" ? income : expense;
  const heading = kind === "income" ? "Income" : "Expenses";
  const addLabel = kind === "income" ? "Add income" : "Add expense";

  const [editing, setEditing] = useState(false);

  if (!existing && !editing) {
    return (
      <section className="rounded-md border border-hair bg-card-2 p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink-2">{heading}</h3>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-sm text-accent hover:text-accent-deep"
        >
          + {addLabel}
        </button>
      </section>
    );
  }

  if (existing && !editing) {
    return (
      <section className="rounded-md border border-hair bg-card-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-ink-2">{heading}</h3>
            <p className="text-sm text-ink">{existing.name}</p>
            <p className="mt-1 text-xs text-ink-3">
              {formatCurrency(existing.annualAmount)} / yr ·{" "}
              {existing.startYear}–{existing.endYear}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-accent hover:text-accent-deep"
          >
            Edit
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-hair bg-card-2 p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink-2">{heading}</h3>
      <FlowEditor
        kind={kind}
        clientId={clientId}
        entityId={entityId}
        entityName={entityName}
        existing={existing}
        planStartYear={planStartYear}
        defaultEndYear={defaultEndYear}
        writer={writer}
        onCancel={() => setEditing(false)}
      />
    </section>
  );
}

// ── Inline editor (shared by income + expense) ────────────────────────────────

interface FlowEditorProps {
  kind: "income" | "expense";
  clientId: string;
  entityId: string;
  entityName: string;
  existing: FlowsTabIncome | FlowsTabExpense | null;
  planStartYear: number;
  defaultEndYear: number;
  writer: WriterShape;
  onCancel: () => void;
}

function FlowEditor({
  kind,
  clientId,
  entityId,
  entityName,
  existing,
  planStartYear,
  defaultEndYear,
  writer,
  onCancel,
}: FlowEditorProps) {
  const defaultName =
    existing?.name ??
    `${entityName} — ${kind === "income" ? "Income" : "Expenses"}`;
  const [name, setName] = useState(defaultName);
  const [amount, setAmount] = useState(String(existing?.annualAmount ?? 0));
  const [startYear, setStartYear] = useState(existing?.startYear ?? planStartYear);
  const [endYear, setEndYear] = useState(existing?.endYear ?? defaultEndYear);
  const [growthRate, setGrowthRate] = useState(
    String(((existing?.growthRate ?? 0.03) * 100).toFixed(2)),
  );
  const [todaysDollars, setTodaysDollars] = useState(
    existing
      ? existing.inflationStartYear != null &&
          existing.inflationStartYear < existing.startYear
      : true,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const growthSource: "inflation" | "custom" =
    existing?.growthSource ?? "inflation";

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        type: kind === "income" ? "business" : "other",
        name,
        annualAmount: String(Number(amount)),
        startYear: String(startYear),
        endYear: String(endYear),
        growthRate: String(Number(growthRate) / 100),
        growthSource,
        ownerEntityId: entityId,
        cashAccountId: null,
        inflationStartYear: todaysDollars ? planStartYear : null,
      };
      const isEdit = !!existing;
      const baseUrl = `/api/clients/${clientId}/${
        kind === "income" ? "incomes" : "expenses"
      }`;
      const url = isEdit ? `${baseUrl}/${existing!.id}` : baseUrl;
      const newId = !isEdit
        ? typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`
        : existing!.id;
      const res = await writer.submit(
        isEdit
          ? {
              op: "edit",
              targetKind: kind,
              targetId: existing!.id,
              desiredFields: body,
            }
          : { op: "add", targetKind: kind, entity: { id: newId, ...body } },
        { url, method: isEdit ? "PUT" : "POST", body },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(json.error ?? "Failed to save");
      }
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      <div>
        <label className={fieldLabelClassName} htmlFor={`flow-${kind}-name`}>
          Name
        </label>
        <input
          id={`flow-${kind}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClassName}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            className={fieldLabelClassName}
            htmlFor={`flow-${kind}-amount`}
          >
            Annual amount
          </label>
          <CurrencyInput
            id={`flow-${kind}-amount`}
            value={amount}
            onChange={setAmount}
          />
        </div>
        <div>
          <label
            className={fieldLabelClassName}
            htmlFor={`flow-${kind}-growth`}
          >
            Growth %
          </label>
          <PercentInput
            id={`flow-${kind}-growth`}
            value={growthRate}
            onChange={setGrowthRate}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-ink-3">
        <input
          type="checkbox"
          checked={todaysDollars}
          onChange={(e) => setTodaysDollars(e.target.checked)}
        />
        Amount in today&apos;s dollars (inflate from {planStartYear})
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabelClassName} htmlFor={`flow-${kind}-start`}>
            Start year
          </label>
          <input
            id={`flow-${kind}-start`}
            type="number"
            value={startYear}
            onChange={(e) => setStartYear(Number(e.target.value))}
            className={inputClassName}
          />
        </div>
        <div>
          <label className={fieldLabelClassName} htmlFor={`flow-${kind}-end`}>
            End year
          </label>
          <input
            id={`flow-${kind}-end`}
            type="number"
            value={endYear}
            onChange={(e) => setEndYear(Number(e.target.value))}
            className={inputClassName}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
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
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Distribution & Tax (business types only) ──────────────────────────────────

function DistributionAndTaxSection({
  entityId,
  clientId,
  distributionPolicyPercent,
  taxTreatment,
}: FlowsTabProps) {
  const [pct, setPct] = useState(
    distributionPolicyPercent != null
      ? String((distributionPolicyPercent * 100).toFixed(2))
      : "",
  );
  const [tx, setTx] = useState(taxTreatment);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/entities/${entityId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distributionPolicyPercent:
              pct.trim() === "" ? null : Number(pct) / 100,
            taxTreatment: tx,
          }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Failed to save");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-hair bg-card-2 p-4">
      <h3 className="text-sm font-semibold text-ink-2">Distributions &amp; taxes</h3>
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      <div>
        <label className={fieldLabelClassName} htmlFor="flow-dist-pct">
          Distribution policy (% of net income to owners)
        </label>
        <PercentInput id="flow-dist-pct" value={pct} onChange={setPct} />
        <p className="mt-1 text-[11px] text-ink-3">
          Engine wiring lands in Phase 3 — saving here persists the value.
        </p>
      </div>

      <div>
        <span className={fieldLabelClassName}>Tax treatment</span>
        <div className="mt-1 flex gap-1.5">
          {(["qbi", "ordinary", "non_taxable"] as const).map((v) => (
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

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
