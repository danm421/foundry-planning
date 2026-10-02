/** Zod `policyType` uses short names; the accounts.subType enum uses the longer
 *  canonical forms. Mapping is 1:1 but explicit so a future enum addition
 *  surfaces as a TS error instead of a silent fallthrough. Shared by the policy
 *  routes (base writes) and the policy dialog (scenario writes). */
export function mapPolicyTypeToSubType(
  t: "term" | "whole" | "universal" | "variable",
): "term" | "whole_life" | "universal_life" | "variable_life" {
  switch (t) {
    case "term":
      return "term";
    case "whole":
      return "whole_life";
    case "universal":
      return "universal_life";
    case "variable":
      return "variable_life";
  }
}
