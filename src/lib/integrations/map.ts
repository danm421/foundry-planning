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
    acct.holdings = (positionsByAccount.get(a.id) ?? []).map(mapProviderPosition);
    return acct;
  });
  return {
    origin: providerId,
    externalHouseholdId: household.id,
    accounts: mapped,
    warnings,
  };
}
