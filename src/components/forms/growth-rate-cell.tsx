"use client";

// The growth rate on a Household Map card: a click-to-open native <select> of
// the same options the full account editor offers for that category.
//
// Custom % is a two-step by design. A <select> cannot host a number input, and
// every other option resolves to a rate on its own. Picking Custom arms the
// percent editor rather than saving; the write lands when the rate is committed,
// carrying source and rate together so the engine never sees "custom" with a
// stale rate.
import { useState } from "react";
import { InlineAmount } from "@/components/forms/inline-amount";
import { InlineSelect } from "@/components/forms/inline-select";
import {
  formatGrowthPct,
  growthEditModeFor,
  growthOptionsFor,
  growthSelectValue,
} from "@/lib/inline-edit/growth-options";
import { patchFromGrowthSelection, type AccountPatch } from "@/lib/inline-edit/account-write";
import type { GrowthContext } from "@/lib/investments/growth-context";
import type { AccountRow } from "@/components/balance-sheet-view";

export interface GrowthRateCellProps {
  row: AccountRow;
  growthContext: GrowthContext;
  /**
   * The plan's SCENARIO-EFFECTIVE inflation rate, for the "Inflation rate"
   * option's label.
   *
   * Deliberately NOT `growthContext.resolvedInflationRate`.
   * `loadImportGrowthContext` reads `plan_settings` with a direct
   * `(clientId, scenarioId)` equality and is called with the BASE scenario id
   * (only base has a row), so its rate is always the base one. This prop comes
   * from `effectiveTree.planSettings.inflationRate` and follows a scenario that
   * overrides inflation. Using the base number here would label the option
   * "2.50% — Inflation rate" on a scenario that actually inflates at 3.5% —
   * the same "two editors disagree" gap `growth-options.ts` exists to close.
   */
  resolvedInflationRate: number;
  /** Per-category default rate as a decimal string — `categoryDefaultRates`. */
  categoryDefaultRates: Record<string, string>;
  canEdit: boolean;
  onSave: (patch: AccountPatch) => Promise<boolean>;
}

export default function GrowthRateCell({
  row,
  growthContext,
  resolvedInflationRate,
  categoryDefaultRates,
  canEdit,
  onSave,
}: GrowthRateCellProps) {
  const [customArmed, setCustomArmed] = useState(false);

  const mode = growthEditModeFor(row.category);
  const label = formatGrowthPct(row.growthRate);

  if (!canEdit || mode === "none") {
    return <span className="tabular text-[11px] text-ink-3">{label}</span>;
  }

  if (customArmed) {
    return (
      <InlineAmount
        mode="percent"
        amount={Number(row.growthRate ?? 0) * 100}
        label={`${row.name} growth rate`}
        onSave={async (nextPct) => {
          const ok = await onSave({
            ...patchFromGrowthSelection("custom"),
            growthRate: String(nextPct / 100),
          });
          setCustomArmed(false);
          return ok;
        }}
        className="min-w-[56px] rounded-sm px-1 py-0.5 text-right tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      />
    );
  }

  // From `categoryDefaultRates` (decimal strings, all ten categories) — NOT
  // `growthContext.categoryDefaults`, which is a differently-shaped map
  // covering only taxable/cash/retirement. See category-default-rates.ts.
  const rawDefault = categoryDefaultRates[row.category];
  const defaultPct =
    rawDefault != null && Number.isFinite(Number(rawDefault))
      ? Math.round(Number(rawDefault) * 10000) / 100
      : null;

  return (
    <InlineSelect
      display={label}
      value={growthSelectValue(row)}
      label={`growth rate for ${row.name}`}
      canEdit
      onSelect={(raw) => {
        // "custom" ARMS the percent editor rather than saving: a <select>
        // cannot host a number input, and every other option resolves to a
        // rate on its own. The write lands when the rate is committed, so the
        // engine never sees "custom" with a stale rate.
        if (raw === "custom") {
          setCustomArmed(true);
          return;
        }
        void onSave(patchFromGrowthSelection(raw));
      }}
      options={growthOptionsFor({
        category: row.category,
        modelPortfolios: growthContext.modelPortfolios,
        fundPortfolios: growthContext.fundPortfolios,
        resolvedInflationRate,
        defaultPctForCategory: defaultPct,
        // The form computes these from the account's holdings and asset
        // allocations, which the Map does not load (and must not fetch — see
        // the zero-client-fetch invariant in types.ts).
        //
        // So the Map offers "Asset mix" ONLY to an account already using it.
        // That keeps a mix-driven account displaying and round-tripping
        // correctly, while refusing to let the advisor newly select a mix we
        // can't confirm has holdings behind it — which would resolve through
        // `resolver.resolveAccountMix` to an empty blend and silently zero the
        // account's growth. Selecting a mix for the first time stays in the
        // full dialog, one click away via the pencil.
        //
        // `assetMixBlendedPct: null` renders the option as a bare
        // "Asset mix (custom)" with no percentage, which is honest: we don't
        // have the blend here.
        assetMixBlendedPct: null,
        hideAssetMix: row.growthSource !== "asset_mix",
      })}
    />
  );
}
