import { colors, colorsLight, data, dataLight } from "@/brand";
import type { Theme } from "@/lib/theme";
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

/**
 * Theme-aware source colors, drawn from the editorial brand data palette so the
 * stacked chart recolors on theme toggle. Ordered so neighbors in SOURCE_ORDER
 * cross hue families; "other" is the muted neutral ink. Roth keeps emerald
 * (tax-free), pension keeps a warm terra.
 */
export function sourceColors(
  theme: Theme,
): Record<WithdrawalSourceCategory, string> {
  const d = theme === "light" ? dataLight : data;
  const c = theme === "light" ? colorsLight : colors;
  return {
    "social-security": d.indigo,
    pension: d.terra,
    "taxable-withdrawal": d.wheat,
    "ira-rmd": d.rose,
    "roth-withdrawal": d.emerald,
    other: c.ink3,
  };
}

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
