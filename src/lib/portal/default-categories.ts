export type TaxonomyLeaf = { slug: string; name: string };
export type TaxonomyGroup = {
  slug: string;
  name: string;
  color: string; // a var(--data-*) token string
  sortOrder: number;
  leaves: TaxonomyLeaf[];
};

// 2-level seeded taxonomy. Group slugs are "<group>"; leaf slugs are
// "<group>-<leaf>". Leaf slugs are the stable PFC-mapping targets — keep in
// sync with pfc-mapping.ts. Colors use the Deep Jewel data palette tokens.
export const DEFAULT_TAXONOMY: TaxonomyGroup[] = [
  { slug: "income", name: "Income", color: "var(--data-green)", sortOrder: 10, leaves: [
    { slug: "income-paycheck", name: "Paycheck" },
    { slug: "income-other", name: "Other Income" },
  ] },
  { slug: "household", name: "Household", color: "var(--data-blue)", sortOrder: 20, leaves: [
    { slug: "household-mortgage", name: "Mortgage & Rent" },
    { slug: "household-home", name: "Home" },
    { slug: "household-utilities", name: "Utilities" },
  ] },
  { slug: "food", name: "Food & Drink", color: "var(--data-orange)", sortOrder: 30, leaves: [
    { slug: "food-groceries", name: "Groceries" },
    { slug: "food-restaurants", name: "Restaurants" },
  ] },
  { slug: "shopping", name: "Shopping", color: "var(--data-purple)", sortOrder: 40, leaves: [
    { slug: "shopping-general", name: "General Merchandise" },
    { slug: "shopping-clothing", name: "Clothing" },
  ] },
  { slug: "lifestyle", name: "Lifestyle", color: "var(--data-pink)", sortOrder: 50, leaves: [
    { slug: "lifestyle-entertainment", name: "Entertainment" },
  ] },
  { slug: "transportation", name: "Transportation", color: "var(--data-teal)", sortOrder: 60, leaves: [
    { slug: "transport-gas", name: "Gas" },
    { slug: "transport-transit", name: "Transit & Auto" },
  ] },
  { slug: "travel", name: "Travel", color: "var(--data-yellow)", sortOrder: 70, leaves: [
    { slug: "travel-travel", name: "Travel" },
  ] },
  { slug: "health", name: "Health", color: "var(--data-red)", sortOrder: 80, leaves: [
    { slug: "health-medical", name: "Medical" },
    { slug: "health-personal-care", name: "Personal Care" },
  ] },
  { slug: "bills", name: "Bills", color: "var(--data-grey)", sortOrder: 90, leaves: [
    { slug: "bills-subscriptions", name: "Subscriptions" },
    { slug: "bills-insurance", name: "Insurance" },
    { slug: "bills-loans", name: "Loan Payments" },
  ] },
  { slug: "services", name: "Services", color: "var(--data-blue)", sortOrder: 100, leaves: [
    { slug: "services-general", name: "General Services" },
    { slug: "services-government", name: "Government & Non-Profit" },
  ] },
  { slug: "financial", name: "Financial", color: "var(--data-grey)", sortOrder: 110, leaves: [
    { slug: "financial-fees", name: "Fees" },
    { slug: "financial-transfers", name: "Transfers" },
  ] },
  { slug: "other", name: "Other", color: "var(--data-grey)", sortOrder: 120, leaves: [
    { slug: "other-misc", name: "Misc" },
  ] },
];

export function buildDefaultCategoryTree(): TaxonomyGroup[] {
  return DEFAULT_TAXONOMY;
}

// Flat set of every valid leaf slug — used by pfc-mapping tests to assert
// every PFC target resolves to a real seeded leaf.
export const DEFAULT_LEAF_SLUGS: ReadonlySet<string> = new Set(
  DEFAULT_TAXONOMY.flatMap((g) => g.leaves.map((l) => l.slug)),
);
