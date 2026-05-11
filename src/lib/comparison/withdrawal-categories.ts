import type { Account } from "@/engine/types";

export type WithdrawalSourceCategory =
  | "social-security"
  | "pension"
  | "taxable-withdrawal"
  | "ira-rmd"
  | "roth-withdrawal"
  | "other";

const ROTH_SUBTYPES = new Set(["roth_ira"]);
const TRADITIONAL_RETIREMENT_SUBTYPES = new Set([
  "traditional_ira",
  "401k",
  "403b",
]);

export const SOURCE_LABELS: Record<WithdrawalSourceCategory, string> = {
  "social-security": "Social Security",
  pension: "Pension / Deferred",
  "taxable-withdrawal": "Taxable Withdrawals",
  "ira-rmd": "IRA / RMD",
  "roth-withdrawal": "Roth Withdrawals",
  other: "Other",
};

export const SOURCE_COLORS: Record<WithdrawalSourceCategory, string> = {
  "social-security": "#2563eb",
  pension: "#ea580c",
  "taxable-withdrawal": "#facc15",
  "ira-rmd": "#f97316",
  "roth-withdrawal": "#16a34a",
  other: "#94a3b8",
};

/** Stable display order (left → right in legend, bottom → top in stack). */
export const SOURCE_ORDER: WithdrawalSourceCategory[] = [
  "social-security",
  "pension",
  "taxable-withdrawal",
  "ira-rmd",
  "roth-withdrawal",
  "other",
];

export function buildAccountSourceMap(
  accounts: readonly Account[],
): Record<string, WithdrawalSourceCategory> {
  const map: Record<string, WithdrawalSourceCategory> = {};
  for (const a of accounts) {
    if (a.category === "retirement") {
      if (ROTH_SUBTYPES.has(a.subType)) map[a.id] = "roth-withdrawal";
      else if (TRADITIONAL_RETIREMENT_SUBTYPES.has(a.subType))
        map[a.id] = "ira-rmd";
      else map[a.id] = "other";
    } else if (a.category === "taxable" || a.category === "cash") {
      map[a.id] = "taxable-withdrawal";
    } else {
      map[a.id] = "other";
    }
  }
  return map;
}
