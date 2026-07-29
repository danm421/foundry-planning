// The cash-flow report's row identity:
//
//   portfolioAssets[t] === portfolioAssets[t-1] + growth[t] + activity[t]
//
// `portfolioAssets` is `liquidTotal`, so growth and activity have to be measured
// over the same accounts — and the same ownership shares — that compose it.
// Each case below is a way that correspondence used to break, leaving a silent
// gap that compounded across the projection.

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, sampleFamilyMembers } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import {
  liquidPortfolioActivity,
  liquidPortfolioGrowth,
  liquidPortfolioWeights,
} from "../portfolio-snapshot";
import type { Account, EntitySummary, FamilyMember, ProjectionYear } from "../types";

const ENT_ACCESSIBLE = "ent-accessible";
const ENT_LOCKED = "ent-locked";
const CHILD_FM = "fm-child";

const entities: EntitySummary[] = [
  {
    id: ENT_ACCESSIBLE,
    name: "HEMS Trust",
    entityType: "trust",
    trustSubType: "ilit",
    isIrrevocable: true,
    isGrantor: false,
    includeInPortfolio: false,
    accessibleToClient: true,
    grantor: "client",
  },
  {
    id: ENT_LOCKED,
    name: "Locked SLAT",
    entityType: "trust",
    trustSubType: "irrevocable",
    isIrrevocable: true,
    isGrantor: false,
    includeInPortfolio: false,
    accessibleToClient: false,
    grantor: "client",
  },
];

const child: FamilyMember = {
  id: CHILD_FM,
  role: "other",
  relationship: "child",
  firstName: "Kid",
  lastName: "Smith",
  dateOfBirth: "2005-01-01",
};

function acct(over: Partial<Account> & Pick<Account, "id" | "category">): Account {
  return {
    name: over.id,
    subType: undefined,
    titlingType: "jtwros",
    value: 500_000,
    basis: 500_000,
    growthRate: 0.06,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...over,
  } as Account;
}

const brokerage = acct({ id: "brokerage", category: "taxable", basis: 400_000 });

const home = acct({
  id: "home",
  category: "real_estate",
  subType: "primary_residence",
  value: 800_000,
  basis: 800_000,
  growthRate: 0.025,
});

const businessInterest = acct({
  id: "biz",
  category: "business",
  value: 600_000,
  basis: 600_000,
  growthRate: 0.04,
});

const accessibleTrust = acct({
  id: "trust-accessible",
  category: "taxable",
  value: 300_000,
  basis: 300_000,
  growthRate: 0.05,
  owners: [{ kind: "entity", entityId: ENT_ACCESSIBLE, percent: 1 }],
});

const lockedTrust = acct({
  id: "trust-locked",
  category: "taxable",
  value: 250_000,
  basis: 250_000,
  growthRate: 0.05,
  owners: [{ kind: "entity", entityId: ENT_LOCKED, percent: 1 }],
});

// Half the account belongs to a child, who is not a household principal, so only
// half its value rolls into the portfolio — while its ledger stays whole-account.
const halfOwned = acct({
  id: "half",
  category: "taxable",
  value: 400_000,
  basis: 400_000,
  growthRate: 0.05,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: CHILD_FM, percent: 0.5 },
  ],
});

function project(accounts: Account[]): ProjectionYear[] {
  // Drop fixture cash-flow so the projection is pure asset roll-forward.
  return runProjection(
    buildClientData({
      accounts,
      entities,
      familyMembers: [...sampleFamilyMembers, child],
      incomes: [],
      expenses: [],
      savingsRules: [],
      withdrawalStrategy: [],
      liabilities: [],
    }),
  );
}

/** Largest |assets - (prior assets + growth + activity)| across the projection. */
function worstGap(years: ProjectionYear[]): number {
  let worst = 0;
  for (let i = 1; i < years.length; i++) {
    const py = years[i];
    const weights = liquidPortfolioWeights(py);
    const expected =
      years[i - 1].portfolioAssets.liquidTotal +
      liquidPortfolioGrowth(py, weights) +
      liquidPortfolioActivity(py, weights);
    worst = Math.max(worst, Math.abs(py.portfolioAssets.liquidTotal - expected));
  }
  return worst;
}

describe("liquid portfolio reconciliation", () => {
  it("reconciles with only liquid accounts", () => {
    expect(worstGap(project([brokerage]))).toBeLessThan(0.01);
  });

  it("reconciles when real estate appreciates alongside the portfolio", () => {
    // Real estate is net worth, not portfolio: its growth must stay out of the
    // Portfolio Growth column, which excludes it from liquidTotal.
    expect(worstGap(project([brokerage, home]))).toBeLessThan(0.01);
  });

  it("reconciles when a business interest appreciates", () => {
    expect(worstGap(project([brokerage, businessInterest]))).toBeLessThan(0.01);
  });

  it("reconciles when an accessible trust is in the portfolio", () => {
    // The mirror case: accessibleTrustAssets DOES count toward liquidTotal, so
    // its growth has to be counted too.
    expect(worstGap(project([brokerage, accessibleTrust]))).toBeLessThan(0.01);
  });

  it("reconciles when a locked trust is excluded from the portfolio", () => {
    expect(worstGap(project([brokerage, lockedTrust]))).toBeLessThan(0.01);
  });

  it("reconciles when an account is only half owned by the household", () => {
    expect(worstGap(project([brokerage, halfOwned]))).toBeLessThan(0.01);
  });

  it("reconciles with every asset shape at once", () => {
    const years = project([
      brokerage, home, businessInterest, accessibleTrust, lockedTrust, halfOwned,
    ]);
    expect(worstGap(years)).toBeLessThan(0.01);
  });

  it("counts only the household's share of a half-owned account's growth", () => {
    const [, y1] = project([halfOwned]);
    const whole = y1.accountLedgers.half.growth;
    expect(whole).toBeGreaterThan(0);
    expect(liquidPortfolioGrowth(y1)).toBeCloseTo(whole / 2, 6);
  });

  it("excludes real-estate growth from portfolio growth entirely", () => {
    const [, y1] = project([home]);
    expect(y1.accountLedgers.home.growth).toBeGreaterThan(0);
    expect(liquidPortfolioGrowth(y1)).toBe(0);
  });
});
