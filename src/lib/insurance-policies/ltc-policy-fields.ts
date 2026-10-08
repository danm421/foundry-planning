// src/lib/insurance-policies/ltc-policy-fields.ts
import type { LtcPolicy } from "@/engine/types";
import { LTC_RIDER_DEFAULTS, LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

/** A policy without its id: the base POST/PATCH body, a scenario edit's desired
 *  fields, and (with an id) a scenario add's entity. */
export type LtcPolicyFields = Omit<LtcPolicy, "id">;

const blankToNull = (s: string | null): string | null => {
  const t = s?.trim() ?? "";
  return t === "" ? null : t;
};

/** The one place a kind's unused fields are cleared, so a policy that switched
 *  kind in the dialog never carries the other kind's values into a save. */
export function normalizeLtcPolicyFields(f: LtcPolicyFields): LtcPolicyFields {
  const out: LtcPolicyFields = { ...f, name: f.name.trim(), carrier: blankToNull(f.carrier), notes: blankToNull(f.notes) };
  if (out.kind === "standalone") {
    out.lifePolicyAccountId = null;
    out.riderBenefitMode = null;
    out.riderMonthlyPct = null;
    out.riderMaxPct = null;
    out.extensionYears = 0;
    out.residualDeathBenefit = 0;
    if (out.benefitPeriodMode !== "years") out.benefitPeriodYears = null;
  } else {
    out.benefitPeriodMode = null;
    out.benefitPeriodYears = null;
    out.sharedCare = false;
    out.annualPremium = 0;
    out.premiumPayMode = "paid_up";
    if (out.riderBenefitMode === "pct_of_face") {
      out.benefitAmount = 0;
      out.benefitUnit = "month";
    } else {
      out.riderMonthlyPct = null;
    }
  }
  if (out.premiumPayMode !== "to_age") out.premiumPayToAge = null;
  if (out.premiumPayMode !== "years") out.premiumPayYears = null;
  return out;
}

/** Switch kind: that kind's starting values for every kind-specific field,
 *  keeping who, what and when. A standalone policy drops its life-policy link;
 *  a rider keeps the caller's (the dialog picks one). */
export function withLtcKind<T extends Omit<LtcPolicyFields, "issueYear">>(f: T, kind: LtcPolicy["kind"]): T {
  if (kind === "standalone") return { ...f, ...LTC_STANDALONE_DEFAULTS };
  return { ...f, ...LTC_RIDER_DEFAULTS };
}
