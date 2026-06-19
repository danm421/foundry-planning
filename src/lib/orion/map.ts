import type {
  AccountCategory,
  AccountSubType,
  ExtractedAccount,
  ExtractedHolding,
} from "@/lib/extraction/types";
import type { OrionAccount, OrionHousehold, OrionPosition } from "./schemas";

type RegMap = { category: AccountCategory; subType: AccountSubType };

const REGISTRATION_TABLE: Array<[RegExp, RegMap]> = [
  [/roth\s*ira/i, { category: "retirement", subType: "roth_ira" }],
  [/traditional\s*ira|rollover\s*ira|\bira\b/i, { category: "retirement", subType: "traditional_ira" }],
  [/401\s*\(?k\)?/i, { category: "retirement", subType: "401k" }],
  [/403\s*\(?b\)?/i, { category: "retirement", subType: "403b" }],
  [/\b529\b/i, { category: "taxable", subType: "529" }],
  [/joint|individual|tenants|twrs|trust|taxable|brokerage/i, { category: "taxable", subType: "brokerage" }],
];

export function mapRegistrationType(raw: string | null | undefined): RegMap & { warning?: string } {
  const text = raw ?? "";
  for (const [re, mapped] of REGISTRATION_TABLE) if (re.test(text)) return mapped;
  return { category: "taxable", subType: "brokerage", warning: `Unmapped Orion registration type: "${raw}"` };
}

export function mapOrionAccount(o: OrionAccount): ExtractedAccount {
  const reg = mapRegistrationType(o.registrationType);
  return {
    name: o.name,
    category: reg.category,
    subType: reg.subType,
    custodian: o.custodian ?? undefined,
    accountNumberLast4: o.accountNumber ? o.accountNumber.slice(-4) : undefined,
    value: o.value ?? undefined,
    basis: o.costBasis ?? undefined,
    externalProvider: "orion",
    externalId: o.id,
    holdings: [],
  };
}

export function mapOrionPosition(o: OrionPosition): ExtractedHolding {
  const hasTicker = !!o.ticker;
  return {
    ticker: hasTicker ? o.ticker! : undefined,
    name: o.description ?? undefined,
    shares: o.units ?? undefined,
    price: o.price ?? undefined,
    costBasis: o.costBasis ?? undefined,
    // Tickered positions get live-priced at commit, so don't carry the statement value.
    // Untickered → carry marketValue so normalizeExtractedHolding treats it as authoritative.
    marketValue: hasTicker ? undefined : (o.marketValue ?? undefined),
  };
}

export type OrionImportPayload = {
  origin: "orion";
  orionHouseholdId: string;
  accounts: ExtractedAccount[];
  warnings: string[];
};

export function mapOrionToImportPayload(
  household: OrionHousehold,
  accounts: OrionAccount[],
  positionsByAccount: Map<string, OrionPosition[]>,
): OrionImportPayload {
  const warnings: string[] = [];
  const mapped = accounts.map((a) => {
    const reg = mapRegistrationType(a.registrationType);
    if (reg.warning) warnings.push(reg.warning);
    const acct = mapOrionAccount(a);
    acct.holdings = (positionsByAccount.get(a.id) ?? []).map(mapOrionPosition);
    return acct;
  });
  return { origin: "orion", orionHouseholdId: household.id, accounts: mapped, warnings };
}
