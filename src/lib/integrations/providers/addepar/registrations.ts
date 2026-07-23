import type { RegistrationTable } from "../../types";

/**
 * Addepar registration/ownership-type vocabulary -> Foundry category/subType.
 * STARTER table — confirm the exact strings Addepar returns and expand.
 *
 * Note: Addepar maps `trust` → `taxable`/`trust` (vs. Schwab's `taxable`/`brokerage`).
 * This follows the plan's intent; alignment with Schwab is a future-work decision.
 */
export const ADDEPAR_REGISTRATIONS: RegistrationTable = [
  [/roth\s*ira/i, { category: "retirement", subType: "roth_ira" }],
  [/traditional\s*ira|rollover\s*ira|sep\s*ira|simple\s*ira|\bira\b/i, { category: "retirement", subType: "traditional_ira" }],
  [/401\s*\(?k\)?/i, { category: "retirement", subType: "401k" }],
  [/403\s*\(?b\)?/i, { category: "retirement", subType: "403b" }],
  [/\b529\b/i, { category: "education_savings", subType: "529" }],
  [/annuit/i, { category: "annuity", subType: "other" }],
  [/trust/i, { category: "taxable", subType: "trust" }],
  [/joint|individual|tenants|twrs|taxable|brokerage/i, { category: "taxable", subType: "brokerage" }],
];
