// src/lib/integrations/providers/schwab/registrations.ts
import type { RegistrationTable } from "../../types";

/**
 * Schwab account-registration vocabulary -> Foundry category/subType.
 *
 * This table is REAL, not speculative: Schwab's registration names are public
 * and stable regardless of which API surface eventually delivers them. Order
 * matters — the first matching pattern wins, so the narrow Roth and rollover
 * patterns must precede the general /ira/ catch-all.
 *
 * Foundry has no sep_ira/simple_ira/utma subtypes, so those fold into the
 * closest valid one. Trusts map to taxable/brokerage, matching the shipped
 * Orion precedent rather than the unused `trust` subType.
 */
export const SCHWAB_REGISTRATIONS: RegistrationTable = [
  [/roth/i, { category: "retirement", subType: "roth_ira" }],
  [/individual\s*401\s*\(?k\)?|company\s*retirement|profit\s*sharing|401\s*\(?k\)?/i, { category: "retirement", subType: "401k" }],
  [/403\s*\(?b\)?/i, { category: "retirement", subType: "403b" }],
  [/rollover|sep[-\s]*ira|simple\s*ira|inherited\s*ira|contributory|traditional|\bira\b/i, { category: "retirement", subType: "traditional_ira" }],
  [/education\s*savings|\besa\b|\b529\b/i, { category: "taxable", subType: "529" }],
  [/joint|individual|tenants|jtwros|community\s*property|custodial|utma|ugma|trust|estate|brokerage|schwab\s*one/i, { category: "taxable", subType: "brokerage" }],
];
