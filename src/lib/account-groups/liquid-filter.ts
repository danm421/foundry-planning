import type { accountCategoryEnum } from "@/db/schema";

export type AccountCategory =
  (typeof accountCategoryEnum)["enumValues"][number];

export const LIQUID_CATEGORIES = new Set<AccountCategory>([
  "taxable",
  "cash",
  "retirement",
]);

export function isLiquid(category: AccountCategory): boolean {
  return LIQUID_CATEGORIES.has(category);
}
