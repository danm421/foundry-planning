import { describe, it, expect } from "vitest";
import type {
  Account,
  ClientData,
  DeathTransfer,
  FamilyMember,
  PlanSettings,
  HypotheticalEstateTax,
} from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import { applyFirstDeath } from "@/engine/death-event";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import { buildEstateFlowSummary } from "@/lib/estate/estate-flow-summary";

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Cooper",
  lastName: "Sample",
  dateOfBirth: "1970-01-01",
};
const spouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE,
  role: "spouse",
  relationship: "other",
  firstName: "Susan",
  lastName: "Sample",
  dateOfBirth: "1972-01-01",
};

const baseSettings: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  taxInflationRate: 0.025,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
};

/**
 *  Estate-flow happy-path coverage for the account-based business model.
 *
 *  Under the legacy entity model this test used a single mixed-ownership
 *  account (80% Cooper / 20% LLC entity) to reproduce a bug where the LLC
 *  slice was dropped from Cooper's Estate. The account-based model has no
 *  business-as-account-owner concept (entity owners are trust-only now), so
 *  the scenario is rebuilt with the same dollar figures via separate
 *  household + business trees:
 *
 *    • Personal Savings: $64,000, 100% Cooper.
 *    • Cooper Holdings LLC (top-level business account): $200,000 value,
 *      100% Cooper. Child cash account under the LLC holds $16,000 →
 *      consolidated business value = $216,000.
 *
 *  After Cooper's first death the Estate Flow's "Cooper's Estate" detail
 *  panel should list:
 *    • Personal Savings row at $64,000 (100% chargeable).
 *    • Cooper Holdings LLC row at the consolidated $216,000.
 *  Total = $280,000 (matches the legacy figure for regression continuity).
 */
function buildPipeline() {
  const savings: Account = {
    id: "acct-savings",
    name: "Personal Savings",
    category: "cash",
    subType: "savings",
    value: 64_000,
    basis: 64_000,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
    ],
  };

  const llc: Account = {
    id: "biz-1",
    name: "Cooper Holdings LLC",
    category: "business",
    subType: "llc",
    value: 200_000,
    basis: 100_000,
    businessType: "llc",
    parentAccountId: null,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
    ],
  };

  const llcCash: Account = {
    id: "biz-1-cash",
    name: "LLC Operating Cash",
    category: "cash",
    subType: "savings",
    value: 16_000,
    basis: 16_000,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    parentAccountId: "biz-1",
    owners: [],
  };

  const firstResult = applyFirstDeath({
    year: 2026,
    deceased: "client",
    survivor: "spouse",
    will: null,
    accounts: [savings, llc, llcCash],
    accountBalances: {
      "acct-savings": 64_000,
      "biz-1": 200_000,
      "biz-1-cash": 16_000,
    },
    basisMap: {
      "acct-savings": 64_000,
      "biz-1": 100_000,
      "biz-1-cash": 16_000,
    },
    incomes: [],
    liabilities: [],
    familyMembers: [clientFm, spouseFm],
    externalBeneficiaries: [],
    entities: [],
    planSettings: baseSettings,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
  });

  const todayHt: HypotheticalEstateTax = {
    year: 2026,
    primaryFirst: {
      firstDecedent: "client",
      firstDeath: firstResult.estateTax,
      firstDeathTransfers: firstResult.transfers,
      totals: {
        federal: firstResult.estateTax.federalEstateTax,
        state: firstResult.estateTax.stateEstateTax,
        admin: firstResult.estateTax.estateAdminExpenses,
        total: firstResult.estateTax.totalTaxesAndExpenses,
      },
    },
  };

  const projection = {
    years: [],
    todayHypotheticalEstateTax: todayHt,
  } as unknown as ProjectionResult;

  const clientData = {
    client: {
      firstName: "Cooper",
      lastName: "Sample",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
      spouseName: "Susan",
      spouseDob: "1972-01-01",
      spouseRetirementAge: 65,
    },
    accounts: [savings, llc, llcCash],
    liabilities: [],
    entities: [],
    incomeSources: [],
    expenses: [],
    familyMembers: [clientFm, spouseFm],
  } as unknown as ClientData;

  const reportData = buildEstateTransferReportData({
    projection,
    asOf: { kind: "today" },
    ordering: "primaryFirst",
    clientData,
    ownerNames: { clientName: "Cooper", spouseName: "Susan" },
  });

  const summary = buildEstateFlowSummary({
    reportData,
    clientData,
    gifts: [],
    ownerNames: { clientName: "Cooper", spouseName: "Susan" },
    asOfYear: 2026,
  })!;

  return { firstResult, reportData, summary };
}

describe("estate-flow — personal savings + family-owned business account", () => {
  it("engine produces a business-succession transfer at the consolidated value", () => {
    const { firstResult } = buildPipeline();
    // Business-succession routes the consolidated LLC value ($216k) to the
    // surviving spouse via fallback. Under the account model the source is
    // the business account's id, not an entity id. The 4b precedence chain
    // also emits a parallel per-account routing transfer for biz-1 at the
    // account's own balance ($200k); Task 1.7 cleanup will suppress that.
    // For now we identify the succession transfer by its consolidated
    // amount, which is the distinguishing signal.
    const bizTransfers = (firstResult.transfers as DeathTransfer[]).filter(
      (t) => t.sourceAccountId === "biz-1" && t.via === "fallback_spouse",
    );
    const succession = bizTransfers.find(
      (t) => Math.abs(t.amount - 216_000) < 1,
    );
    expect(succession, "consolidated business-succession transfer").toBeDefined();
    expect(succession!.recipientKind).toBe("spouse");
  });

  it("gross-estate lines include a consolidated business line for the LLC", () => {
    const { firstResult } = buildPipeline();
    // The dedicated business-consolidation line is keyed by accountId, with
    // entityId: null. The per-account loop also emits a duplicate line for
    // the same accountId at the account's own balance (Task 1.7 cleanup
    // will remove the double-count); narrowing on entityId === null
    // isolates the consolidated one.
    const bizLine = firstResult.estateTax.grossEstateLines.find(
      (l) => l.accountId === "biz-1" && l.entityId === null,
    );
    expect(bizLine).toBeDefined();
    expect(bizLine!.amount).toBeCloseTo(216_000, 0);
    expect(bizLine!.label).toContain("Cooper Holdings LLC");
  });

  // With Task 1.7's gross-estate double-count fix, the per-account business
  // line is suppressed and only the consolidated $216k line remains in the
  // gross-estate cap. consolidateBySource then scales the LLC's
  // transfers (per-account routing $200k + business-succession $216k = $416k)
  // back to that $216k cap, so the LLC row reads $216k and Cooper's Estate
  // totals $280k.
  it("estate flow's Cooper's Estate detail panel lists Savings ($64k) AND the LLC ($216k)", () => {
    const { summary } = buildPipeline();
    const lines = summary.firstDeath!.estateLines;

    const savings = lines.find((l) => l.sourceAccountId === "acct-savings");
    expect(savings, "Personal Savings row in estateLines").toBeDefined();
    expect(savings!.amount).toBeCloseTo(64_000, 0);

    const business = lines.find((l) => l.sourceAccountId === "biz-1");
    expect(business, "Cooper Holdings LLC row in estateLines").toBeDefined();
    expect(business!.amount).toBeCloseTo(216_000, 0);

    expect(summary.firstDeath!.estateValue).toBeCloseTo(280_000, 0);
  });
});
