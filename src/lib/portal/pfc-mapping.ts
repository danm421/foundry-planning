// Plaid Personal Finance Category v2 → our default leaf slug (first guess on
// ingest). Resolution: detailed override → primary → null. Keep targets in
// sync with default-categories.ts (asserted by the test).
const PRIMARY_TO_SLUG: Record<string, string> = {
  INCOME: "income-paycheck",
  TRANSFER_IN: "financial-transfers",
  TRANSFER_OUT: "financial-transfers",
  LOAN_PAYMENTS: "bills-loans",
  BANK_FEES: "financial-fees",
  ENTERTAINMENT: "lifestyle-entertainment",
  FOOD_AND_DRINK: "food-restaurants",
  GENERAL_MERCHANDISE: "shopping-general",
  HOME_IMPROVEMENT: "household-home",
  MEDICAL: "health-medical",
  PERSONAL_CARE: "health-personal-care",
  GENERAL_SERVICES: "services-general",
  GOVERNMENT_AND_NON_PROFIT: "services-government",
  TRANSPORTATION: "transport-transit",
  TRAVEL: "travel-travel",
  RENT_AND_UTILITIES: "household-utilities",
};

// Detailed → slug overrides where the primary's default leaf is too coarse.
const DETAILED_TO_SLUG: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: "food-groceries",
  TRANSPORTATION_GAS: "transport-gas",
  RENT_AND_UTILITIES_RENT: "household-mortgage",
  RENT_AND_UTILITIES_RENT_AND_MORTGAGE: "household-mortgage",
};

export function mapPfcToSlug(
  primary: string | null,
  detailed: string | null,
): string | null {
  if (detailed && DETAILED_TO_SLUG[detailed]) return DETAILED_TO_SLUG[detailed];
  if (primary && PRIMARY_TO_SLUG[primary]) return PRIMARY_TO_SLUG[primary];
  return null;
}

export type TransactionType = "income" | "expense" | "transfer";

// Default classification at ingest. Card payments arrive as LOAN_PAYMENTS and
// stay 'expense' — the client can reclassify to 'transfer' in the panel.
export function pfcToType(primary: string | null): TransactionType {
  if (primary === "INCOME") return "income";
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return "transfer";
  return "expense";
}
