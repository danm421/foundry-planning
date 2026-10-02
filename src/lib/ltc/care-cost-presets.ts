import type { CareSetting } from "@/engine/types";

/** CareScout 2025 Cost of Care Survey, US national medians
 *  (carescout.com/cost-of-care, fetched 2026-10-01). Annual dollars. */
export const LTC_CARE_COST_PRESETS = {
  asOf: 2025,
  annual: {
    in_home: 80_080, // non-medical caregiver, $35/hr × 44 hr/wk
    assisted_living: 74_400, // $6,200/month
    nursing_semi_private: 114_975, // $315/day
    nursing_private: 129_575, // $355/day
  },
} as const;

export const CARE_SETTING_LABELS: Record<CareSetting, string> = {
  in_home: "In-home care",
  assisted_living: "Assisted living",
  nursing_semi_private: "Nursing home, semi-private room",
  nursing_private: "Nursing home, private room",
  custom: "Custom",
};

/** CareScout 2022–2025: private nursing room ≈5.2%/yr, assisted living
 *  ≈6.7%/yr. 5% sits at the conservative end of that run. */
export const DEFAULT_CARE_INFLATION = 0.05;
export const DEFAULT_SELLING_COST_PCT = 0.06;
export const DEFAULT_CARE_START_AGE = 85;
export const DEFAULT_CARE_YEARS = 3;

export function presetAnnualCost(setting: CareSetting): number | null {
  return setting === "custom" ? null : LTC_CARE_COST_PRESETS.annual[setting];
}
