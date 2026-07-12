export type FoundryAccountTypeMapping = {
  category: "cash" | "retirement" | "taxable";
  subType:
    | "checking"
    | "savings"
    | "hsa"
    | "cd"
    | "money_market"
    | "401k"
    | "403b"
    | "traditional_ira"
    | "roth_ira"
    | "sep_ira"
    | "simple_ira"
    | "401a"
    | "brokerage"
    | "529"
    | "other";
};

/**
 * Maps Plaid's account type/subtype to Foundry's accounts.category + accounts.subType.
 * Returns null for unsupported types (loan / credit / mortgage / other).
 *
 * Plaid normalizes subtype strings inconsistently across institutions —
 * "money market" vs "money_market", "roth ira" vs "roth_ira" — so we
 * normalize to snake_case before matching.
 *
 * Source: https://plaid.com/docs/api/accounts/#account-type-schema
 */
export function mapPlaidToFoundry(
  type: string,
  subtype: string | null | undefined,
): FoundryAccountTypeMapping | null {
  const norm = (subtype ?? "").trim().toLowerCase().replace(/\s+/g, "_");

  if (type === "depository") {
    switch (norm) {
      case "checking":
      case "cash_management":
      case "paypal":
        return { category: "cash", subType: "checking" };
      case "savings":
        return { category: "cash", subType: "savings" };
      case "hsa":
        return { category: "cash", subType: "hsa" };
      case "cd":
        return { category: "cash", subType: "cd" };
      case "money_market":
        return { category: "cash", subType: "money_market" };
      default:
        return { category: "cash", subType: "other" };
    }
  }

  if (type === "investment") {
    switch (norm) {
      case "401k":
        return { category: "retirement", subType: "401k" };
      case "403b":
        return { category: "retirement", subType: "403b" };
      case "ira":
        return { category: "retirement", subType: "traditional_ira" };
      case "roth_ira":
        return { category: "retirement", subType: "roth_ira" };
      case "sep_ira":
        return { category: "retirement", subType: "sep_ira" };
      case "simple_ira":
        return { category: "retirement", subType: "simple_ira" };
      case "401a":
        return { category: "retirement", subType: "401a" };
      case "529":
        return { category: "taxable", subType: "529" };
      case "brokerage":
        return { category: "taxable", subType: "brokerage" };
      default:
        // Unknown investment subtype — treat as taxable brokerage.
        return { category: "taxable", subType: "brokerage" };
    }
  }

  // loan / credit / mortgage / other are unsupported.
  return null;
}

export type FoundryLiabilityMapping = { liabilityType: string };

/**
 * Maps a Plaid `credit` / `loan` account to our liabilities.liabilityType.
 * Returns null for non-debt Plaid types (depository / investment) so the
 * caller falls through to mapPlaidToFoundry. Mortgages arrive as
 * type="loan", subtype="mortgage" (and sometimes type="mortgage").
 * Source: https://plaid.com/docs/api/accounts/#account-type-schema
 */
export function mapPlaidToLiability(
  type: string,
  subtype: string | null | undefined,
): FoundryLiabilityMapping | null {
  const norm = (subtype ?? "").trim().toLowerCase().replace(/\s+/g, "_");

  if (type === "credit") {
    // credit card, paypal credit, etc. — all revolving.
    return { liabilityType: "credit_card" };
  }

  if (type === "mortgage") {
    return { liabilityType: "mortgage" };
  }

  if (type === "loan") {
    switch (norm) {
      case "mortgage":
        return { liabilityType: "mortgage" };
      case "home_equity":
      case "heloc":
        return { liabilityType: "heloc" };
      case "auto":
        return { liabilityType: "auto" };
      case "student":
        return { liabilityType: "student" };
      case "line_of_credit":
      case "personal":
        return { liabilityType: "personal" };
      default:
        return { liabilityType: "other" };
    }
  }

  return null;
}
