// The Insurance page's loader reads from the SCENARIO's effective tree: a policy
// a scenario added shows, a face value a scenario edited shows, and the base
// policy table is read only to restore a portfolio-driven policy's RAW
// post-payout rate (the tree carries the portfolio's resolved rate instead).
// Mocked at the DB / loader boundary — which tree reaches the view is what's
// under test, not any WHERE.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";
const BASE_SCENARIO_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_FM = "44444444-4444-4444-8444-444444444444";
const SPOUSE_FM = "55555555-5555-4555-8555-555555555555";
const MP = "66666666-6666-4666-8666-666666666666";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");
const tableName = (t: unknown): string => (t as Record<symbol, string> | null)?.[DRIZZLE_NAME] ?? "";

let rowsByTable: Record<string, unknown[]> = {};

vi.mock("@/db", () => {
  const chain = (rows: unknown[]) => {
    const node = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    node.where = () => node;
    node.orderBy = () => node;
    return node;
  };
  return { db: { select: () => ({ from: (table: unknown) => chain(rowsByTable[tableName(table)] ?? []) }) } };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
vi.mock("@/lib/db-helpers", () => ({ getOrgId: vi.fn(async () => FIRM_ID) }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/insurance-policies/load-policies", () => ({ loadPoliciesByAccountIds: vi.fn() }));

import { loadInsuranceViewProps } from "../load-view-props";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadPoliciesByAccountIds } from "@/lib/insurance-policies/load-policies";

const policy = (over: Record<string, unknown> = {}) => ({
  faceValue: 500000, costBasis: 0, premiumAmount: 9000, premiumYears: null, premiumPayer: "owner",
  policyType: "whole", termIssueYear: null, termLengthYears: null, endsAtInsuredRetirement: false,
  cashValueGrowthMode: "basic", premiumScheduleMode: "off", deathBenefitScheduleMode: "off",
  incomeScheduleMode: "off", postPayoutGrowthRate: 0.06, postPayoutModelPortfolioId: null,
  cashValueSchedule: [], ...over,
});

const lifeAccount = (id: string, name: string, lifeInsurance: unknown, over: Record<string, unknown> = {}) => ({
  id, name, category: "life_insurance", subType: "whole_life", value: 125000, basis: 0,
  insuredPerson: "client", activationYear: null, activationYearRef: null,
  owners: [{ kind: "family_member", familyMemberId: CLIENT_FM, percent: 1 }],
  lifeInsurance, ...over,
});

function tree(over: Record<string, unknown> = {}) {
  return {
    client: {
      firstName: "Cooper", spouseName: "Jane", dateOfBirth: "1970-01-01", lifeExpectancy: 95,
      spouseDob: "1972-01-01", spouseLifeExpectancy: 95, retirementAge: 65, planEndAge: 95,
      spouseRetirementAge: 65,
    },
    accounts: [],
    incomes: [],
    planSettings: { planStartYear: 2026, planEndYear: 2061, inflationRate: 0.025 },
    familyMembers: [
      { id: CLIENT_FM, role: "client", firstName: "Cooper", lastName: "C", relationship: "child", dateOfBirth: "1970-01-01" },
      { id: SPOUSE_FM, role: "spouse", firstName: "Jane", lastName: "C", relationship: "child", dateOfBirth: "1972-01-01" },
    ],
    entities: [{ id: "ent-1", name: "Cooper ILIT", entityType: "trust", crummeyPowers: true, includeInPortfolio: false, isGrantor: false }],
    externalBeneficiaries: [{ id: "ext-1", name: "Red Cross", kind: "charity", charityType: "public" }],
    disabilityPolicies: [],
    ...over,
  };
}

function mountTree(t: ReturnType<typeof tree>, basePolicies: Record<string, unknown> = {}) {
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: t,
    warnings: [],
    resolutionContext: { resolvedInflationRate: 0.031 },
  } as never);
  vi.mocked(loadPoliciesByAccountIds).mockResolvedValue(basePolicies as never);
}

beforeEach(() => {
  rowsByTable = {
    clients: [{ id: CLIENT_ID, firmId: FIRM_ID }],
    scenarios: [{ id: BASE_SCENARIO_ID, clientId: CLIENT_ID, isBaseCase: true }],
    model_portfolios: [{ id: MP, name: "Conservative" }],
  };
  vi.mocked(loadEffectiveTree).mockReset();
  vi.mocked(loadPoliciesByAccountIds).mockReset();
});

async function ok(scenarioParam?: string) {
  const result = await loadInsuranceViewProps(CLIENT_ID, scenarioParam);
  if (result.status !== "ok") throw new Error("expected ok");
  return result;
}

describe("loadInsuranceViewProps", () => {
  it("reports a plan with no base case", async () => {
    rowsByTable.scenarios = [];
    expect(await loadInsuranceViewProps(CLIENT_ID, undefined)).toEqual({ status: "no-base-case" });
  });

  it("loads the effective tree for the scenario asked for", async () => {
    mountTree(tree());
    await ok("scn-9");
    expect(loadEffectiveTree).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, "scn-9", {});
  });

  it("lists a policy the scenario added, though no base row exists for it", async () => {
    mountTree(tree({ accounts: [lifeAccount("scn-added", "Scenario term", policy({ policyType: "term", faceValue: 750000 }))] }), {});
    const { props } = await ok("scn-9");
    expect(props.accounts.map((a) => a.id)).toEqual(["scn-added"]);
    expect(props.policies["scn-added"]).toMatchObject({ policyType: "term", faceValue: 750000 });
  });

  it("shows the scenario's face value, not the base row's", async () => {
    mountTree(
      tree({ accounts: [lifeAccount("p1", "Whole 100", policy({ faceValue: 900000 }))] }),
      { p1: policy({ faceValue: 500000 }) },
    );
    expect((await ok("scn-9")).props.policies.p1.faceValue).toBe(900000);
  });

  it("restores the raw custom rate for a base policy that names a model portfolio", async () => {
    mountTree(
      tree({ accounts: [lifeAccount("p1", "Whole 100", policy({ postPayoutGrowthRate: 0.0544, postPayoutModelPortfolioId: MP }))] }),
      { p1: policy({ postPayoutGrowthRate: 0.07, postPayoutModelPortfolioId: MP }) },
    );
    expect((await ok("scn-9")).props.policies.p1.postPayoutGrowthRate).toBe(0.07);
  });

  it("leaves the rate alone when the policy has no portfolio", async () => {
    mountTree(
      tree({ accounts: [lifeAccount("p1", "Whole 100", policy({ postPayoutGrowthRate: 0.08 }))] }),
      { p1: policy({ postPayoutGrowthRate: 0.07 }) },
    );
    expect((await ok("scn-9")).props.policies.p1.postPayoutGrowthRate).toBe(0.08);
  });

  it("takes people, trusts and charities from the tree, with the beneficiaries on each account", async () => {
    const refs = [{ id: "b1", tier: "primary", percentage: 100, familyMemberId: SPOUSE_FM, sortOrder: 0 }];
    mountTree(tree({ accounts: [lifeAccount("p1", "Whole 100", policy(), { beneficiaries: refs })] }));
    const { props } = await ok("scn-9");
    expect(props.familyMembers.map((f) => f.id)).toEqual([CLIENT_FM, SPOUSE_FM]);
    expect(props.entities).toEqual([{ id: "ent-1", name: "Cooper ILIT", entityType: "trust", crummeyPowers: true }]);
    expect(props.externalBeneficiaries).toEqual([{ id: "ext-1", name: "Red Cross", kind: "charity", notes: null }]);
    expect(props.accounts[0].beneficiaries).toEqual(refs);
    expect(props.accounts[0].ownerRef).toEqual({ kind: "family", id: CLIENT_FM });
  });

  it("takes the plan years and disability policies from the tree, and the scenario's inflation", async () => {
    mountTree(tree({ planSettings: { planStartYear: 2030, planEndYear: 2070, inflationRate: 0.025 }, disabilityPolicies: [{ id: "d1", name: "LTD", insured: "client" }] }));
    const { props, disabilityProps } = await ok("scn-9");
    expect(props.scheduleStartYear).toBe(2030);
    expect(props.resolvedInflationRate).toBe(0.031);
    expect(disabilityProps.planStartYear).toBe(2030);
    expect(disabilityProps.planEndYear).toBe(2070);
    expect(disabilityProps.policies).toEqual([{ id: "d1", name: "LTD", insured: "client" }]);
  });
});
