// The Techniques page's loader reads reinvestments from the SCENARIO's effective
// tree and hands the form everything it needs to open on the scenario's values
// (no base-only fetch): the raw portfolio / rate / realization inputs, the group
// keys, and `accountIds` as the INDIVIDUAL picks only — the members a group
// expands to are left out, so a save writes the picks and the group as the user
// chose them. Mocked at the DB / loader boundary.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";
const BASE_SCENARIO_ID = "33333333-3333-4333-8333-333333333333";

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

import { loadTechniquesViewProps } from "../load-view-props";
import { loadEffectiveTree } from "@/lib/scenario/loader";

const account = (id: string, category: string) => ({
  id, name: id, category, subType: "x", value: 1000, owners: [], isDefaultChecking: false,
});

const reinvestment = (over: Record<string, unknown> = {}) => ({
  id: "ri-1", name: "Switch", accountIds: ["a-brokerage"], groupKeys: [], year: 2035, yearRef: null,
  targetType: "model_portfolio", realizeTaxesOnSwitch: false, newGrowthRate: 0.04,
  soldFractionByAccount: {}, modelPortfolioId: "mp-1", customGrowthRate: null,
  customPctOrdinaryIncome: null, customPctLtCapitalGains: null,
  customPctQualifiedDividends: null, customPctTaxExempt: null, ...over,
});

function mountTree(reinvestments: unknown[], groupMembers: Record<string, string[]> = {}) {
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: {
      client: { firstName: "Cooper", spouseName: null },
      accounts: [
        account("a-brokerage", "taxable"),
        account("a-brokerage-2", "taxable"),
        account("a-cash", "cash"),
        account("a-ira", "retirement"),
      ],
      liabilities: [],
      reinvestments,
    },
    warnings: [],
    resolutionContext: {
      resolver: { resolvePortfolio: () => ({ geoReturn: 0.05 }) },
      accountGroupMembersById: new Map(Object.entries(groupMembers)),
    },
  } as never);
}

async function reinvestmentProps(scenarioParam = "scn-9") {
  const result = await loadTechniquesViewProps(CLIENT_ID, scenarioParam);
  if (result.status !== "ok") throw new Error("expected ok");
  return result.props.reinvestments;
}

beforeEach(() => {
  rowsByTable = {
    clients: [{ id: CLIENT_ID, firmId: FIRM_ID, crmHouseholdId: "h1" }],
    crm_household_contacts: [{ householdId: "h1", role: "primary", dateOfBirth: "1970-01-01" }],
    scenarios: [{ id: BASE_SCENARIO_ID, clientId: CLIENT_ID, isBaseCase: true }],
    model_portfolios: [{ id: "mp-1", name: "Balanced" }],
  };
  vi.mocked(loadEffectiveTree).mockReset();
});

describe("loadTechniquesViewProps — reinvestments", () => {
  it("hands the form the scenario's raw portfolio, rate and realization inputs", async () => {
    mountTree([
      reinvestment({
        targetType: "custom", modelPortfolioId: null, customGrowthRate: 0.065,
        customPctOrdinaryIncome: 0.5, customPctLtCapitalGains: 0.2,
        customPctQualifiedDividends: 0.2, customPctTaxExempt: 0.1,
      }),
    ]);
    const [row] = await reinvestmentProps();
    expect(row).toMatchObject({
      id: "ri-1", targetType: "custom", modelPortfolioId: null, customGrowthRate: 0.065,
      customPctOrdinaryIncome: 0.5, customPctLtCapitalGains: 0.2,
      customPctQualifiedDividends: 0.2, customPctTaxExempt: 0.1,
    });
  });

  it("reads the portfolio the scenario switched to, and coerces stored string numbers", async () => {
    mountTree([reinvestment({ modelPortfolioId: "mp-scenario", customGrowthRate: "0.07" })]);
    const [row] = await reinvestmentProps();
    expect(row.modelPortfolioId).toBe("mp-scenario");
    expect(row.customGrowthRate).toBe(0.07);
  });

  it("always supplies the detail fields (null, not undefined), so the form never backfills", async () => {
    mountTree([reinvestment({ modelPortfolioId: undefined, customGrowthRate: undefined })]);
    const [row] = await reinvestmentProps();
    expect(row.modelPortfolioId).toBeNull();
    expect(row.customGrowthRate).toBeNull();
  });

  it("lists only the individual picks, dropping the accounts a default group expands to", async () => {
    mountTree([
      reinvestment({ accountIds: ["a-brokerage", "a-brokerage-2", "a-ira"], groupKeys: ["taxable"] }),
    ]);
    const [row] = await reinvestmentProps();
    expect(row.accountIds).toEqual(["a-ira"]);
    expect(row.groupKeys).toEqual(["taxable"]);
  });

  it("drops the accounts a custom group expands to", async () => {
    mountTree(
      [reinvestment({ accountIds: ["a-cash", "a-ira"], groupKeys: ["grp-1"] })],
      { "grp-1": ["a-cash"] },
    );
    expect((await reinvestmentProps())[0].accountIds).toEqual(["a-ira"]);
  });

  it("keeps a group-only reinvestment's empty pick list empty", async () => {
    mountTree([reinvestment({ accountIds: ["a-brokerage", "a-brokerage-2"], groupKeys: ["taxable"] })]);
    expect((await reinvestmentProps())[0].accountIds).toEqual([]);
  });

  it("leaves a reinvestment with no groups untouched", async () => {
    mountTree([reinvestment({ accountIds: ["a-cash", "a-ira"], groupKeys: undefined })]);
    const [row] = await reinvestmentProps();
    expect(row.accountIds).toEqual(["a-cash", "a-ira"]);
    expect(row.groupKeys).toEqual([]);
  });
});
