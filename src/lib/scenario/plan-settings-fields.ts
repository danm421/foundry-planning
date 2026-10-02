// src/lib/scenario/plan-settings-fields.ts
//
// The plan-settings forms speak DB column names with decimal strings (the
// PUT /plan-settings body). A scenario edit speaks ENGINE keys with numbers —
// `applyScenarioChanges` writes it straight onto `ClientData.planSettings`,
// past the `parseFloat`s and renames in `loadClientData`. Promotion then has to
// land those engine keys back on DB columns. This module is the one map
// between the three.
import { toNumberIfNumericString } from "@/engine/scenario/applyChanges";

/** Plan-settings form/route keys (DB column names) whose engine key differs. */
export const PLAN_SETTINGS_ENGINE_KEY: Record<string, string> = {
  outOfHouseholdDniRate: "outOfHouseholdRate",
  capitalLossCarryforwardSt: "capitalLossCarryforwardShortTerm",
  capitalLossCarryforwardLt: "capitalLossCarryforwardLongTerm",
};

const COLUMN_FOR_ENGINE_KEY = new Map(
  Object.entries(PLAN_SETTINGS_ENGINE_KEY).map(([column, engine]) => [engine, column]),
);

/** Keys the plan-settings forms send that live on the `client` singleton. */
export const CLIENT_SINGLETON_FORM_KEYS = ["coveredByWorkplacePlan", "spouseCoveredByWorkplacePlan"] as const;

/** Enum and id keys: kept as sent even when the value looks numeric. */
const STRING_KEYS = new Set([
  "residenceState",
  "taxEngineMode",
  "inflationRateSource",
  "growthSourceTaxable",
  "growthSourceCash",
  "growthSourceRetirement",
  "growthSourceRealEstate",
  "growthSourceBusiness",
  "growthSourceLifeInsurance",
  "growthSourceStockOptions",
  "modelPortfolioIdTaxable",
  "modelPortfolioIdCash",
  "modelPortfolioIdRetirement",
  "surplusSaveAccountId",
]);

/** The DB splits the engine's `priorTaxableGifts` pair into two columns. */
const PRIOR_GIFT_SIDE = {
  priorTaxableGiftsClient: "client",
  priorTaxableGiftsSpouse: "spouse",
} as const;

export interface ScenarioPlanSettingsPatch {
  planSettings: Record<string, unknown>; // engine keys, numbers coerced
  client: Record<string, unknown>; // workplace-coverage keys
}

/** Translate one autosave patch (route/DB key names, decimal strings) into the
 *  scenario-edit shape. `priorTaxableGifts` needs the current pair because the
 *  form sends one side at a time. */
export function formPatchToScenarioFields(
  patch: Record<string, unknown>,
  current: { priorTaxableGifts: { client: number; spouse: number } },
): ScenarioPlanSettingsPatch {
  const planSettings: Record<string, unknown> = {};
  const client: Record<string, unknown> = {};
  let priorTaxableGifts: { client: number; spouse: number } | null = null;

  for (const [key, value] of Object.entries(patch)) {
    if ((CLIENT_SINGLETON_FORM_KEYS as readonly string[]).includes(key)) {
      client[key] = value;
    } else if (key === "priorTaxableGiftsClient" || key === "priorTaxableGiftsSpouse") {
      // A cleared side is 0, as `loadClientData` reads a null column.
      priorTaxableGifts ??= { ...current.priorTaxableGifts };
      priorTaxableGifts[PRIOR_GIFT_SIDE[key]] = Number(value ?? 0);
    } else {
      const engineKey = Object.hasOwn(PLAN_SETTINGS_ENGINE_KEY, key)
        ? PLAN_SETTINGS_ENGINE_KEY[key]
        : key;
      planSettings[engineKey] = STRING_KEYS.has(key) ? value : toNumberIfNumericString(value);
    }
  }
  if (priorTaxableGifts) planSettings.priorTaxableGifts = priorTaxableGifts;

  return { planSettings, client };
}

/** Engine-keyed plan_settings `set` → DB column names, for promotion. */
export function planSettingsEngineToColumns(set: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(set)) {
    if (key === "priorTaxableGifts") {
      const gifts = value as { client: number; spouse: number };
      out.priorTaxableGiftsClient = gifts.client;
      out.priorTaxableGiftsSpouse = gifts.spouse;
    } else {
      out[COLUMN_FOR_ENGINE_KEY.get(key) ?? key] = value;
    }
  }
  return out;
}
