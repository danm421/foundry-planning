import type { DisabilityPolicy } from "@/engine/types";

/** The one place a long-term benefit period becomes prose.
 *
 *  Two surfaces print it — the Insurance page's disability row and the solver's
 *  Disability stressor — and they must not word one policy two ways. The
 *  longest arm is 42 characters against a solver pane of roughly 233px, so the
 *  first person who shortens it for that pane would otherwise shorten one copy
 *  and leave the other. The row's own wrapper adds the "not yet set" arms its
 *  half-filled FORM shape needs; those never reach a saved policy. */
export function benefitPeriodText(
  period: NonNullable<DisabilityPolicy["longTerm"]>["benefitPeriod"],
): string {
  switch (period.mode) {
    case "to_age":
      return `to age ${period.age}`;
    case "to_ssnra":
      return "to Social Security full retirement age";
    case "years":
      return `for ${period.years} years`;
    case "lifetime":
      return "for life";
  }
}
