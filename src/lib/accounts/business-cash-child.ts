import type { accounts } from "@/db/schema";

/**
 * The "<business> — Cash" default checking account every new top-level
 * business gets. The engine looks for this exact row to route the business's
 * income, expense and retained earnings. It inherits ownership through
 * `parentAccountId` — no account_owners rows — and `isDefaultChecking` brings
 * the PUT/DELETE guards along (category, sub-type, parent, ownership and
 * deletion are all locked).
 *
 * Shared by the two paths that create a business: `createAccountForClient`
 * and the AI import's commit, which inserts its rows directly.
 */
export function businessCashChild(args: {
  clientId: string;
  scenarioId: string;
  businessName: string;
  businessId: string;
}): typeof accounts.$inferInsert {
  return {
    clientId: args.clientId,
    scenarioId: args.scenarioId,
    name: `${args.businessName} — Cash`,
    category: "cash",
    subType: "checking",
    value: "0",
    basis: "0",
    rothValue: "0",
    growthRate: null,
    rmdEnabled: false,
    growthSource: "default",
    turnoverPct: "0",
    annualPropertyTax: "0",
    propertyTaxGrowthRate: "0.03",
    propertyTaxGrowthSource: "custom",
    titlingType: "jtwros",
    flowMode: "annual",
    parentAccountId: args.businessId,
    isDefaultChecking: true,
  };
}
