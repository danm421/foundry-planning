// src/lib/integrations/providers/orion/registrations.ts
import type { RegistrationTable } from "../../types";

/** Orion registration-type vocabulary -> Foundry category/subType. */
export const ORION_REGISTRATIONS: RegistrationTable = [
  [/roth\s*ira/i, { category: "retirement", subType: "roth_ira" }],
  [/traditional\s*ira|rollover\s*ira|\bira\b/i, { category: "retirement", subType: "traditional_ira" }],
  [/401\s*\(?k\)?/i, { category: "retirement", subType: "401k" }],
  [/403\s*\(?b\)?/i, { category: "retirement", subType: "403b" }],
  [/\b529\b/i, { category: "taxable", subType: "529" }],
  [/joint|individual|tenants|twrs|trust|taxable|brokerage/i, { category: "taxable", subType: "brokerage" }],
];
