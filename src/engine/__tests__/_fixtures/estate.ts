import type { ClientData, ClientInfo, PlanSettings, Account, Will } from "@/engine/types";

const LEGACY_FM_CLIENT = "fm-client";
const LEGACY_FM_SPOUSE = "fm-spouse";

/**
 * Minimal married estate scenario for gift-ledger integration testing:
 * client dies first in 2030, spouse survives to 2057. Single $20M
 * cash account jointly owned. Spouse's will routes residual to a kid.
 */
export function buildMinimalEstateScenario(opts: { priorClient: number; priorSpouse?: number }): ClientData {
  const client: ClientInfo = {
    firstName: "Test", lastName: "Client",
    dateOfBirth: "1960-01-01",
    retirementAge: 65, planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 70,             // dies 2030
    spouseDob: "1962-01-01",
    spouseLifeExpectancy: 95,       // dies 2057
  };
  const planSettings: PlanSettings = {
    flatFederalRate: 0.22,
    flatStateRate: 0.05,
    inflationRate: 0.025,
    taxInflationRate: 0.025,
    planStartYear: 2026,
    planEndYear: 2060,
    estateAdminExpenses: 0,
    flatStateEstateRate: 0,
    priorTaxableGifts: { client: opts.priorClient, spouse: opts.priorSpouse ?? 0 },
  };
  const accounts: Account[] = [
    {
      id: "acct-cash",
      name: "Joint Cash",
      category: "cash", subType: "savings",
      value: 20_000_000, basis: 20_000_000,
      growthRate: 0, rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ],
    } as unknown as Account,
  ];
  const wills: Will[] = [
    // Client's will: residual to kid (NOT to spouse — so first death has tax exposure
    // and the priorTaxableGifts delta shows up in tentativeTaxBase).
    {
      id: "w-client", grantor: "client",
      bequests: [{
        id: "beq-c", name: "Residual to kid",
        kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fm-kid", percentage: 100, sortOrder: 0 }],
      }],
    },
    {
      id: "w-spouse", grantor: "spouse",
      bequests: [{
        id: "beq-s", name: "Residual to kid",
        kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "fm-kid", percentage: 100, sortOrder: 0 }],
      }],
    },
  ];
  return {
    client,
    accounts,
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [
      { id: LEGACY_FM_CLIENT, role: "client", relationship: "self", firstName: "Test", lastName: "Client" },
      { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "spouse", firstName: "Spouse", lastName: "Client" },
      { id: "fm-kid", role: "child", relationship: "child", firstName: "Kid", lastName: "Client" },
    ] as unknown as ClientData["familyMembers"],
    wills,
    giftEvents: [],
  } as unknown as ClientData;
}
