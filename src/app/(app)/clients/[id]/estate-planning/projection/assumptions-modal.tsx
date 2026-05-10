"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import type { PlanSettings } from "@/engine/types";

interface Props {
  open: boolean;
  clientId: string;
  planSettings: PlanSettings;
  onClose: () => void;
}

type EditableNumberKey =
  | "flatFederalRate"
  | "flatStateRate"
  | "inflationRate"
  | "planStartYear"
  | "planEndYear"
  | "estateAdminExpenses"
  | "flatStateEstateRate"
  | "irdTaxRate"
  | "taxInflationRate"
  | "ssWageGrowthRate"
  | "outOfHouseholdRate";

interface FieldDef {
  key: EditableNumberKey;
  label: string;
  format: "pct" | "currency" | "year";
  optional?: boolean;
}

/**
 * Restricted to engine PlanSettings (engine/types.ts:577). DB-row growth fields
 * (defaultGrowth*) are intentionally not surfaced here — see future-work/ui.md.
 */
const FIELDS: FieldDef[] = [
  { key: "flatFederalRate", label: "Federal tax rate", format: "pct" },
  { key: "flatStateRate", label: "State tax rate", format: "pct" },
  { key: "inflationRate", label: "Inflation rate", format: "pct" },
  { key: "planStartYear", label: "Plan start year", format: "year" },
  { key: "planEndYear", label: "Plan end year", format: "year" },
  { key: "estateAdminExpenses", label: "Estate admin expenses", format: "currency", optional: true },
  { key: "flatStateEstateRate", label: "State estate tax rate", format: "pct", optional: true },
  { key: "irdTaxRate", label: "IRD tax rate", format: "pct", optional: true },
  { key: "taxInflationRate", label: "Tax-bracket inflation rate", format: "pct", optional: true },
  { key: "ssWageGrowthRate", label: "SS wage growth rate", format: "pct", optional: true },
  { key: "outOfHouseholdRate", label: "Out-of-household DNI rate", format: "pct", optional: true },
];

type FormState = Record<EditableNumberKey, string> & {
  taxEngineMode: "flat" | "bracket";
};

function planSettingsToForm(p: PlanSettings): FormState {
  return {
    flatFederalRate: String(p.flatFederalRate ?? ""),
    flatStateRate: String(p.flatStateRate ?? ""),
    inflationRate: String(p.inflationRate ?? ""),
    planStartYear: String(p.planStartYear ?? ""),
    planEndYear: String(p.planEndYear ?? ""),
    estateAdminExpenses: p.estateAdminExpenses != null ? String(p.estateAdminExpenses) : "",
    flatStateEstateRate: p.flatStateEstateRate != null ? String(p.flatStateEstateRate) : "",
    irdTaxRate: p.irdTaxRate != null ? String(p.irdTaxRate) : "",
    taxInflationRate: p.taxInflationRate != null ? String(p.taxInflationRate) : "",
    ssWageGrowthRate: p.ssWageGrowthRate != null ? String(p.ssWageGrowthRate) : "",
    outOfHouseholdRate: p.outOfHouseholdRate != null ? String(p.outOfHouseholdRate) : "",
    taxEngineMode: p.taxEngineMode ?? "flat",
  };
}

function buildPayload(form: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const raw = form[f.key];
    if (raw === "" || raw == null) continue;
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    payload[f.key] = n;
  }
  payload.taxEngineMode = form.taxEngineMode;
  return payload;
}

export function AssumptionsModal({ open, clientId, planSettings, onClose }: Props) {
  const initial = useMemo(() => planSettingsToForm(planSettings), [planSettings]);
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      if (!res.ok) {
        let msg = `${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          // non-JSON body
        }
        throw new Error(msg);
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Edit assumptions"
      size="lg"
      primaryAction={{ label: "Save", onClick: handleSave, loading: busy }}
      secondaryAction={{ label: "Cancel", onClick: onClose, disabled: busy }}
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wider text-ink-3">
              {f.label}
              {f.optional && <span className="ml-1 normal-case text-ink-4">(optional)</span>}
            </span>
            <input
              type="number"
              step={f.format === "pct" ? "0.001" : "1"}
              value={form[f.key]}
              aria-label={f.label}
              onChange={(e) => update(f.key, e.target.value)}
              className="rounded border border-hair bg-card-2 px-2 py-1 tabular-nums text-ink"
            />
          </label>
        ))}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-3">Tax engine mode</span>
          <select
            value={form.taxEngineMode}
            aria-label="Tax engine mode"
            onChange={(e) => update("taxEngineMode", e.target.value as "flat" | "bracket")}
            className="rounded border border-hair bg-card-2 px-2 py-1 text-ink"
          >
            <option value="flat">Flat</option>
            <option value="bracket">Bracket</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-[12px] text-crit">
          {error}
        </p>
      )}
    </DialogShell>
  );
}
