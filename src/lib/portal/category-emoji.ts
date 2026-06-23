// src/lib/portal/category-emoji.ts
//
// Static slug -> emoji map for the portal Budget page. Categories are seeded by
// stable slug (see default-categories.ts); the DB `icon` column is unused, so we
// resolve emoji here instead of a migration + backfill. Leaf slugs are the
// primary target (the detail header shows the leaf glyph); group slugs get a
// representative fallback for when a group itself is selected.

const LEAF_EMOJI: Record<string, string> = {
  // income (excluded from the budget view, kept for completeness)
  "income-paycheck": "💵",
  "income-other": "🪙",
  // household
  "household-mortgage": "💰",
  "household-home": "🏠",
  "household-utilities": "🔌",
  // food & drink
  "food-groceries": "🥑",
  "food-restaurants": "🍔",
  // shopping
  "shopping-general": "📦",
  "shopping-clothing": "👕",
  // lifestyle
  "lifestyle-entertainment": "🎬",
  // transportation
  "transport-gas": "⛽",
  "transport-transit": "🚊",
  // travel
  "travel-travel": "✈️",
  // health
  "health-medical": "🩺",
  "health-personal-care": "🧴",
  // bills
  "bills-subscriptions": "💳",
  "bills-insurance": "🛡️",
  "bills-loans": "🏦",
  // services
  "services-general": "🛠️",
  "services-government": "🏛️",
  // financial
  "financial-fees": "🏧",
  "financial-transfers": "🔁",
  // other
  "other-misc": "🗂️",
};

const GROUP_EMOJI: Record<string, string> = {
  income: "💵",
  household: "🏠",
  food: "🍽️",
  shopping: "🛍️",
  lifestyle: "🎬",
  transportation: "🚗",
  travel: "✈️",
  health: "❤️",
  bills: "🧾",
  services: "🛠️",
  financial: "💵",
  other: "🗂️",
};

const FALLBACK_EMOJI = "🏷️";

/**
 * Resolve a category emoji from its stable slug. Leaf slugs win; group slugs
 * fall back to a representative glyph; unknown/user-created (null) slugs get a
 * generic tag. Never throws — always returns a renderable string.
 */
export function categoryEmoji(slug: string | null | undefined): string {
  if (!slug) return FALLBACK_EMOJI;
  return LEAF_EMOJI[slug] ?? GROUP_EMOJI[slug] ?? FALLBACK_EMOJI;
}
