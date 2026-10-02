// src/lib/scenario/growth-settings-override.ts
//
// Growth & inflation settings are resolved at LOAD time: `loadClientData`
// bakes category defaults, growth sources, model portfolios and the resolved
// inflation rate into every account, income, expense and savings rule. A
// scenario `plan_settings` edit of those keys is too late to change any of it.
// So the scenario loader folds the scenario's active edits of these keys into
// an override, and runs the base load again with the override applied to the
// raw `plan_settings` row. Every derived value then follows by construction.
import { resolveEffectiveToggleState, toNumberIfNumericString } from "@/engine/scenario/applyChanges";
import type { ScenarioChange, ToggleGroup, ToggleState } from "@/engine/scenario/types";

/** The `plan_settings` keys resolved at load time, by DB column name. Each is
 *  also its own engine key. Stock-option growth is left out on purpose: no form
 *  edits it. */
export const GROWTH_SETTINGS_KEYS = [
  "inflationRateSource", "inflationRate",
  "defaultGrowthTaxable", "defaultGrowthCash", "defaultGrowthRetirement",
  "defaultGrowthRealEstate", "defaultGrowthBusiness", "defaultGrowthLifeInsurance",
  "growthSourceTaxable", "growthSourceCash", "growthSourceRetirement",
  "growthSourceRealEstate", "growthSourceBusiness", "growthSourceLifeInsurance",
  "modelPortfolioIdTaxable", "modelPortfolioIdCash", "modelPortfolioIdRetirement",
  "taxInflationRate", "ssWageGrowthRate",
  "medicarePremiumInflationRate", "medicarePremiumInflationEnabled",
] as const;
export type GrowthSettingsKey = (typeof GROWTH_SETTINGS_KEYS)[number];
export type GrowthSettingsOverride = Partial<
  Record<GrowthSettingsKey, string | number | boolean | null>
>;

const GROWTH_KEYS: ReadonlySet<string> = new Set(GROWTH_SETTINGS_KEYS);

type EditPayload = Record<string, { from: unknown; to: unknown }>;

const isPlanSettingsEdit = (c: ScenarioChange) =>
  c.opType === "edit" && c.targetKind === "plan_settings";

/** Numbers (and numeric strings) round to the columns' 4 decimal places, so a
 *  promoted value reloads identically. Enum, id, boolean and null values pass
 *  through. */
function toOverrideValue(to: unknown): string | number | boolean | null {
  const v = toNumberIfNumericString(to);
  return typeof v === "number" ? Math.round(v * 1e4) / 1e4 : (v as string | boolean | null);
}

/** The growth & inflation values this scenario sets: the `to` side of its
 *  active `plan_settings` edits, in `orderIndex` order, last write wins. Active
 *  means what `applyScenarioChanges` means: ungrouped, or in a group that is on
 *  once `requiresGroupId` chains resolve. `{}` when nothing applies. */
export function growthSettingsOverride(
  changes: ScenarioChange[],
  toggleState: ToggleState,
  groups: ToggleGroup[],
): GrowthSettingsOverride {
  const effective = resolveEffectiveToggleState(toggleState, groups);
  const active = changes
    .filter(
      (c) =>
        isPlanSettingsEdit(c) &&
        (c.toggleGroupId == null || effective[c.toggleGroupId] === true),
    )
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const override: GrowthSettingsOverride = {};
  for (const change of active) {
    for (const [key, { to }] of Object.entries((change.payload ?? {}) as EditPayload)) {
      if (GROWTH_KEYS.has(key)) override[key as GrowthSettingsKey] = toOverrideValue(to);
    }
  }
  return override;
}

/** The custom inflation rate as STORED: the scenario's own value when it set
 *  one, else the base row's column. The tree's `inflationRate` is the RESOLVED
 *  rate (the asset class's under that source), so it cannot say what the custom
 *  box holds. */
export function storedInflationRate(baseColumn: string, override: GrowthSettingsOverride): string {
  return override.inflationRate != null ? String(override.inflationRate) : baseColumn;
}

/** Remove the growth keys from every `plan_settings` edit, dropping an edit
 *  left with nothing. They reach the tree through the override load instead;
 *  applied as an overlay, a raw `inflationRate` would overwrite the engine's
 *  RESOLVED rate. Changes without growth keys come back by reference. */
export function stripGrowthSettingsKeys(changes: ScenarioChange[]): ScenarioChange[] {
  return changes.flatMap((c) => {
    if (!isPlanSettingsEdit(c)) return [c];
    const entries = Object.entries((c.payload ?? {}) as EditPayload);
    if (!entries.some(([key]) => GROWTH_KEYS.has(key))) return [c];
    const kept = entries.filter(([key]) => !GROWTH_KEYS.has(key));
    return kept.length > 0 ? [{ ...c, payload: Object.fromEntries(kept) }] : [];
  });
}
