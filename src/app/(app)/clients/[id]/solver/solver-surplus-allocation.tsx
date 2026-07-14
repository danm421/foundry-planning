"use client";

import type { ClientData } from "@/engine/types";
import type { SolverMutation, SolverMutationKey } from "@/lib/solver/types";
import { controllingEntity } from "@/engine/ownership";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { SolverFieldSlider } from "./solver-field-slider";

interface Props {
  workingTree: ClientData;
  baseClientData: ClientData;
  onChange: (m: SolverMutation) => void;
  onResetField: (keys: SolverMutationKey[]) => void;
}

/** Select value standing in for "no account" → null (household checking). */
const CHECKING = "";

/**
 * Surplus Cash Flow lever for the solver Techniques tab. Reads the working
 * tree's `surplusSpendPct` / `surplusSaveAccountId` (single source of truth),
 * emits one combined `surplus-allocation` mutation on either knob, and offers a
 * "Reset to base" affordance only when the working value diverges from base.
 */
export function SolverSurplusAllocation({
  workingTree,
  baseClientData,
  onChange,
  onResetField,
}: Props) {
  const ps = workingTree.planSettings;
  const spendPct = ps.surplusSpendPct ?? 0; // decimal 0..1
  const saveAccountId = ps.surplusSaveAccountId ?? null;

  const base = baseClientData.planSettings;
  const changed =
    (base.surplusSpendPct ?? 0) !== spendPct ||
    (base.surplusSaveAccountId ?? null) !== saveAccountId;

  // Household-owned accounts only (not controlled by a trust/LLC), sourced from
  // the working tree so an inline solver-draft account can be a destination.
  const householdAccounts = (workingTree.accounts ?? [])
    .filter((a) => !controllingEntity(a))
    .map((a) => ({ id: a.id, name: a.name }));

  const emit = (next: { spendPct: number; saveAccountId: string | null }) =>
    onChange({ kind: "surplus-allocation", ...next });

  return (
    <>
      <div className="max-w-[16rem]">
        <label
          htmlFor="surplus-spend-pct"
          className="mb-1.5 flex items-center gap-1.5 text-[11px] text-ink-3"
        >
          Spend % of surplus
          <FieldTooltip text="Controls what happens to any positive net cash flow each year, after savings, gifts, and taxes are applied. By default, surplus accumulates in the household checking account." />
        </label>
        <SolverFieldSlider
          id="surplus-spend-pct"
          label="Spend % of surplus"
          value={Math.round(spendPct * 100)}
          min={0}
          max={100}
          step={1}
          format={(n) => `${n}%`}
          onCommit={(n) => emit({ spendPct: n / 100, saveAccountId })}
        />
      </div>

      <label className="block max-w-[20rem]">
        <span className="mb-1.5 block text-[11px] text-ink-3">Save remainder to</span>
        <select
          aria-label="Save remainder to"
          value={saveAccountId ?? CHECKING}
          onChange={(e) => emit({ spendPct, saveAccountId: e.target.value || null })}
          className="w-full rounded-md border border-hair-2 bg-card-2 px-2.5 py-1.5 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
        >
          <option value={CHECKING}>Household checking (default)</option>
          {householdAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      {changed ? (
        <button
          type="button"
          onClick={() => onResetField(["surplus-allocation"])}
          className="self-start text-[12px] text-accent hover:underline focus-visible:outline-none focus-visible:underline"
        >
          Reset to base
        </button>
      ) : null}
    </>
  );
}
