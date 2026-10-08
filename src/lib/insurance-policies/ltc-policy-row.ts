// src/lib/insurance-policies/ltc-policy-row.ts
import type { NewLtcPolicyRow } from "@/db/schema";
import { LTC_POLICY_FIELD_KEYS, type LtcPolicyCreateInput } from "@/lib/schemas/ltc-policies";
import type { LtcPolicyFields } from "./ltc-policy-fields";

/** The decimal columns: strings on the wire, `null` stays `null`. */
const DECIMAL_KEYS = new Set<string>([
  "benefitAmount", "riderMonthlyPct", "riderMaxPct", "residualDeathBenefit",
  "homeCarePct", "inflationRate", "annualPremium",
]);

/** Parsed request fields → row columns, for ONLY the keys present. Walks the
 *  schema's own key list, so nothing outside it can reach `.set()`. */
export function ltcFieldsToColumns(fields: Partial<LtcPolicyFields>): Partial<NewLtcPolicyRow> {
  const out: Record<string, unknown> = {};
  for (const key of LTC_POLICY_FIELD_KEYS) {
    const v = (fields as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = DECIMAL_KEYS.has(key) ? (v == null ? null : String(v)) : v;
  }
  return out as Partial<NewLtcPolicyRow>;
}

/** A parsed create body → complete fields. The create schema leaves its
 *  optional nullable keys absent; they read as `null`. */
export function ltcFieldsFromCreate(d: LtcPolicyCreateInput): LtcPolicyFields {
  return {
    ...d,
    carrier: d.carrier ?? null,
    lifePolicyAccountId: d.lifePolicyAccountId ?? null,
    riderBenefitMode: d.riderBenefitMode ?? null,
    riderMonthlyPct: d.riderMonthlyPct ?? null,
    benefitPeriodMode: d.benefitPeriodMode ?? null,
    benefitPeriodYears: d.benefitPeriodYears ?? null,
    riderMaxPct: d.riderMaxPct ?? null,
    premiumPayToAge: d.premiumPayToAge ?? null,
    premiumPayYears: d.premiumPayYears ?? null,
    notes: d.notes ?? null,
  };
}
