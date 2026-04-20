export interface PlanSettingsInflationInput {
  inflationRateSource: "asset_class" | "custom";
  inflationRate: string | number | null;
}

export interface AssetClassInflationInput {
  geometricReturn: string | number;
}

/**
 * Resolve the effective inflation rate the projection engine should use.
 *
 * - source = "custom" → the stored plan_settings.inflation_rate (0 if null).
 * - source = "asset_class" → the client-level CMA override if present,
 *   else the firm's Inflation asset class, else 0.
 */
export function resolveInflationRate(
  planSettings: PlanSettingsInflationInput,
  inflationAssetClass: AssetClassInflationInput | null,
  clientOverride: AssetClassInflationInput | null = null,
): number {
  if (planSettings.inflationRateSource === "custom") {
    return planSettings.inflationRate == null ? 0 : Number(planSettings.inflationRate);
  }
  const pick = clientOverride ?? inflationAssetClass;
  return pick ? Number(pick.geometricReturn) : 0;
}
