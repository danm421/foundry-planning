// src/lib/fact-finder/records/types.ts
import type { MatchCandidates } from "@/lib/imports/match";

/**
 * Records already on the plan that a fact finder row can link to. Type-only
 * imports keep this module (and the pure matcher that reads it) DB-free.
 */
export interface ExistingRecords {
  candidates: MatchCandidates;
  externalBeneficiaries: Array<{ id: string; name: string }>;
  disabilityPolicies: Array<{ id: string; name: string; insured: string; carrier: string | null }>;
  ltcPolicies: Array<{ id: string; name: string; insured: string; carrier: string | null }>;
  gifts: Array<{ id: string; year: number; grantor: string; amount: number | null }>;
  savingsRules: Array<{ id: string; accountId: string; accountName: string }>;
  stockOptionGrants: Array<{
    id: string;
    accountName: string;
    grantNumber: string | null;
    grantDate: string;
    grantType: string;
  }>;
  notesReceivable: Array<{ id: string; name: string; faceValue: number }>;
}

export function emptyExistingRecords(): ExistingRecords {
  return {
    candidates: {
      accounts: [],
      incomes: [],
      expenses: [],
      liabilities: [],
      familyMembers: [],
      lifePolicies: [],
      wills: [],
      entities: [],
      livingSlots: [],
      family: [],
    },
    externalBeneficiaries: [],
    disabilityPolicies: [],
    ltcPolicies: [],
    gifts: [],
    savingsRules: [],
    stockOptionGrants: [],
    notesReceivable: [],
  };
}
