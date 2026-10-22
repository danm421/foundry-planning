// src/lib/integrations/map.ts
import type { ExtractedAccount, ExtractedHolding } from "@/lib/extraction/types";
import type {
  ProviderAccount,
  ProviderHousehold,
  ProviderId,
  ProviderPosition,
  RegistrationMap,
  RegistrationTable,
} from "./types";

export function mapRegistrationType(
  raw: string | null | undefined,
  table: RegistrationTable,
): RegistrationMap & { warning?: string } {
  const text = raw ?? "";
  for (const [re, mapped] of table) if (re.test(text)) return mapped;
  return {
    category: "taxable",
    subType: "brokerage",
    warning: `Unmapped registration type: "${raw}"`,
  };
}

export function mapProviderAccount(
  a: ProviderAccount,
  providerId: ProviderId,
  table: RegistrationTable,
): ExtractedAccount {
  const reg = mapRegistrationType(a.registrationType, table);
  return {
    name: a.name,
    category: reg.category,
    subType: reg.subType,
    custodian: a.custodian ?? undefined,
    accountNumberLast4: a.accountNumber ? a.accountNumber.slice(-4) : undefined,
    value: a.value ?? undefined,
    basis: a.costBasis ?? undefined,
    externalProvider: providerId,
    externalId: a.id,
    holdings: [],
  };
}

export function mapProviderPosition(p: ProviderPosition): ExtractedHolding {
  return {
    ticker: p.ticker ?? undefined,
    name: p.description ?? undefined,
    shares: p.units ?? undefined,
    price: p.price ?? undefined,
    costBasis: p.costBasis ?? undefined,
    // Tickered positions get live-priced at commit, so don't carry the statement
    // value. Untickered -> carry marketValue so normalizeExtractedHolding treats
    // it as authoritative.
    marketValue: p.ticker ? undefined : (p.marketValue ?? undefined),
  };
}

/** A custodian's margin debit, which a feed reports as a negative "Margin" position. */
function isMarginDebit(p: ProviderPosition): boolean {
  return /\bmargin\b/i.test(p.description ?? "") && (p.marketValue ?? 0) < 0;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export type IntegrationImportPayload = {
  origin: ProviderId;
  externalHouseholdId: string;
  accounts: ExtractedAccount[];
  warnings: string[];
};

export function mapToImportPayload(
  providerId: ProviderId,
  table: RegistrationTable,
  household: ProviderHousehold,
  accounts: ProviderAccount[],
  positionsByAccount: Map<string, ProviderPosition[]>,
): IntegrationImportPayload {
  const warnings: string[] = [];
  const mapped = accounts.map((a) => {
    const reg = mapRegistrationType(a.registrationType, table);
    if (reg.warning) warnings.push(reg.warning);
    const acct = mapProviderAccount(a, providerId, table);
    const positions = positionsByAccount.get(a.id) ?? [];
    acct.holdings = positions.filter((p) => !isMarginDebit(p)).map(mapProviderPosition);
    const debits = positions.filter(isMarginDebit);
    if (debits.length > 0) {
      // The debit becomes the account's margin loan. The feed's account value
      // and cost basis already have it subtracted, and an account with a loan
      // is saved at its securities' value with the loan beside it.
      const loan = -debits.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
      const loanBasis = -debits.reduce((sum, p) => sum + (p.costBasis ?? 0), 0);
      acct.marginBalance = cents(loan);
      if (acct.value != null) acct.value = cents(acct.value + loan);
      if (acct.basis != null) acct.basis = cents(acct.basis + loanBasis);
    }
    return acct;
  });
  return {
    origin: providerId,
    externalHouseholdId: household.id,
    accounts: mapped,
    warnings,
  };
}
