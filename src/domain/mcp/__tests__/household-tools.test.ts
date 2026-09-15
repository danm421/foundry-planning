import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted, not a bare top-level const: `vi.mock` factories run during ESM
// import evaluation, before this file's own top-level statements — a plain
// `const getOverviewData = vi.fn()` referenced inside the mock factory below
// throws "Cannot access before initialization" (TDZ). vi.hoisted() runs ahead
// of the vi.mock calls, so the references are ready in time. Every mock fn a
// test body reconfigures lives here (Task 7/8's own trap).
const {
  getOverviewData,
  getClientWithContacts,
  loadEffectiveTree,
  loadLifeInsuranceInventory,
  loadDisabilityPolicies,
  verifyClientAccessFor,
} = vi.hoisted(() => ({
  getOverviewData: vi.fn(),
  getClientWithContacts: vi.fn(),
  loadEffectiveTree: vi.fn(),
  loadLifeInsuranceInventory: vi.fn(),
  loadDisabilityPolicies: vi.fn(),
  verifyClientAccessFor: vi.fn(),
}));

vi.mock("@/lib/overview/get-overview-data", () => ({ getOverviewData }));
vi.mock("@/lib/clients/get-client-with-contacts", () => ({ getClientWithContacts }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree }));
vi.mock("@/lib/insurance-policies/load-li-inventory", () => ({ loadLifeInsuranceInventory }));
vi.mock("@/lib/insurance-policies/load-disability-policies", () => ({ loadDisabilityPolicies }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { householdTools } from "../tools/household";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { foundryUrl } from "@/lib/mcp/foundry-url";

// tokenSubject deliberately differs from userId, mirroring discovery-tools.test.ts:
// a handler that read principal.tokenSubject instead of principal.userId would
// pass every case here undetected if the two collided.
const principal: McpPrincipal = {
  userId: "user_1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "sub_1",
};
const byName = (n: string) => householdTools.find((t) => t.name === n)!;

const DENIED_MESSAGE = "Household not found or access denied";

beforeEach(() => {
  verifyClientAccessFor.mockReset();
  verifyClientAccessFor.mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
  getOverviewData.mockReset();
  getClientWithContacts.mockReset();
  loadEffectiveTree.mockReset();
  loadLifeInsuranceInventory.mockReset();
  loadDisabilityPolicies.mockReset();
});

describe("get_client_summary", () => {
  it("returns the full KPI block plus a deep link, never the raw projection array", async () => {
    getOverviewData.mockResolvedValue({
      kpi: { netWorth: 3_200_000, liquidPortfolio: 1_100_000, yearsToRetirement: 3 },
      allocation: [{ group: "Equity", value: 900_000, pct: 0.8 }],
      lifeEvents: [{ year: 2029, label: "Retirement", kind: "retirement" }],
      runway: { minNetWorth: 900_000, netWorthSeries: [1, 2, 3] },
      openItemsPreview: [],
      totalOpen: 0,
      accountCount: 12,
      projection: [{ huge: true }],
      alertInputs: { projectionError: null },
    });
    getClientWithContacts.mockResolvedValue({
      firstName: "John", lastName: "Smith", spouseFirstName: "Susan", spouseLastName: "Smith",
    });
    const out = await byName("get_client_summary").run({ clientId: "c1" }, principal);
    expect(out).toEqual({
      identity: { primaryName: "John Smith", spouseName: "Susan Smith" },
      netWorth: 3_200_000,
      liquidPortfolio: 1_100_000,
      yearsToRetirement: 3,
      minProjectedNetWorth: 900_000,
      allocation: [{ group: "Equity", value: 900_000, pct: 0.8 }],
      lifeEvents: [{ year: 2029, label: "Retirement", kind: "retirement" }],
      openItemCount: 0,
      openItemsPreview: [],
      accountCount: 12,
      projectionAvailable: true,
      foundryUrl: foundryUrl("c1", "overview"),
    });
  });

  it("suppresses only the projection-derived fields when the projection failed", async () => {
    getOverviewData.mockResolvedValue({
      kpi: { netWorth: 5_000_000, liquidPortfolio: 2_000_000, yearsToRetirement: 10 },
      allocation: [{ group: "Bonds", value: 500_000, pct: 0.25 }],
      lifeEvents: [{ year: 2030, label: "Should be suppressed", kind: "retirement" }],
      runway: { minNetWorth: 4_000_000, netWorthSeries: [1] },
      openItemsPreview: [{ id: "oi1" }],
      totalOpen: 3,
      accountCount: 7,
      projection: [],
      alertInputs: { projectionError: "engine exploded" },
    });
    getClientWithContacts.mockResolvedValue({ firstName: "A", lastName: "B" });
    const out = (await byName("get_client_summary").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.projectionAvailable).toBe(false);
    // Suppressed: the two fields actually derived from the projection.
    expect(out.minProjectedNetWorth).toBeNull();
    expect(out.lifeEvents).toEqual([]);
    // NOT suppressed: computed independently of the projection.
    expect(out.netWorth).toBe(5_000_000);
    expect(out.liquidPortfolio).toBe(2_000_000);
    expect(out.allocation).toEqual([{ group: "Bonds", value: 500_000, pct: 0.25 }]);
    expect(out.openItemCount).toBe(3);
    expect(out.openItemsPreview).toEqual([{ id: "oi1" }]);
    expect(out.accountCount).toBe(7);
  });

  it("passes the client id and the firm from the token, and handles a contactless client", async () => {
    getOverviewData.mockResolvedValue({
      kpi: { netWorth: 0, liquidPortfolio: 0, yearsToRetirement: null },
      allocation: [], lifeEvents: [], runway: { minNetWorth: 0, netWorthSeries: [] },
      openItemsPreview: [], totalOpen: 0, accountCount: 0,
      alertInputs: { projectionError: null },
    });
    getClientWithContacts.mockResolvedValue(null);
    const out = (await byName("get_client_summary").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(getOverviewData).toHaveBeenCalledWith("c1", "org_1", "base");
    expect(getClientWithContacts).toHaveBeenCalledWith("c1", "org_1");
    expect(out.identity).toEqual({ primaryName: null, spouseName: null });
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("get_client_summary").run({ clientId: "c1" }, principal)).rejects.toThrow(
      DENIED_MESSAGE,
    );
    expect(getOverviewData).not.toHaveBeenCalled();
  });

  it("carries read-only annotations and a real title", () => {
    const tool = byName("get_client_summary");
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.title).toMatch(/\S/);
    expect(tool.description).toMatch(/\S/);
  });
});

describe("get_balance_sheet", () => {
  it("returns zeros for a household with no accounts or liabilities, plus a deep link", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: {} });
    const out = await byName("get_balance_sheet").run({ clientId: "c1" }, principal);
    expect(out).toEqual({
      scenarioId: "base",
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
      assetsByCategory: [],
      liabilities: [],
      accountCount: 0,
      foundryUrl: foundryUrl("c1", "balanceSheet"),
    });
  });

  it("rolls accounts up by category (summing same-category rows, defaulting a missing category to 'other') and sums liabilities", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        accounts: [
          { name: "Brokerage", category: "taxable", value: 500_000 },
          { name: "401k", category: "retirement", value: 300_000 },
          { name: "IRA", category: "retirement", value: 200_000 },
          { name: "Mystery", value: 50_000 },
        ],
        liabilities: [
          { name: "Mortgage", balance: 400_000 },
          { name: "Car Loan", balance: 20_000 },
        ],
      },
    });
    const out = (await byName("get_balance_sheet").run(
      { clientId: "c1", scenarioId: "s1" },
      principal,
    )) as {
      totalAssets: number;
      totalLiabilities: number;
      netWorth: number;
      accountCount: number;
      scenarioId: string;
      assetsByCategory: { category: string; value: number }[];
      liabilities: { name: string | null; balance: number }[];
    };
    expect(out.totalAssets).toBe(1_050_000);
    expect(out.totalLiabilities).toBe(420_000);
    expect(out.netWorth).toBe(630_000);
    expect(out.accountCount).toBe(4);
    expect(out.scenarioId).toBe("s1");
    expect(out.assetsByCategory).toEqual(
      expect.arrayContaining([
        { category: "taxable", value: 500_000 },
        { category: "retirement", value: 500_000 },
        { category: "other", value: 50_000 },
      ]),
    );
    expect(out.liabilities).toEqual(
      expect.arrayContaining([
        { name: "Mortgage", balance: 400_000 },
        { name: "Car Loan", balance: 20_000 },
      ]),
    );
  });

  it("passes scenarioId to loadEffectiveTree, defaulting to base", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: {} });
    await byName("get_balance_sheet").run({ clientId: "c1" }, principal);
    expect(loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "base", {});

    loadEffectiveTree.mockClear();
    loadEffectiveTree.mockResolvedValue({ effectiveTree: {} });
    await byName("get_balance_sheet").run({ clientId: "c1", scenarioId: "s99" }, principal);
    expect(loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "s99", {});
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("get_balance_sheet").run({ clientId: "c1" }, principal)).rejects.toThrow(
      DENIED_MESSAGE,
    );
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("carries read-only annotations and a real title", () => {
    const tool = byName("get_balance_sheet");
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.title).toMatch(/\S/);
    expect(tool.description).toMatch(/\S/);
  });
});

describe("list_plan_details", () => {
  it("masks account numbers in returned rows and echoes the requested kind", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { accounts: [{ name: "Joint", accountNumber: "12345678" }] },
    });
    const out = (await byName("list_plan_details").run(
      { clientId: "c1", kind: "account" },
      principal,
    )) as { rows: Record<string, unknown>[]; count: number; kind: string };
    expect(out.rows[0].accountNumber).toBe("••••5678");
    expect(out.count).toBe(1);
    expect(out.kind).toBe("account");
  });

  it("applies limit and offset, and reports totalCount against the unsliced list", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { expenses: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    });
    const out = (await byName("list_plan_details").run(
      { clientId: "c1", kind: "expense", limit: 2, offset: 1 },
      principal,
    )) as { rows: unknown[]; count: number; totalCount: number };
    expect(out.rows).toHaveLength(2);
    expect(out.rows).toEqual([{ n: 2 }, { n: 3 }]);
    expect(out.totalCount).toBe(3);
  });

  it("defaults limit to 50 when omitted", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `e${i}` }));
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { expenses: many } });
    const out = (await byName("list_plan_details").run(
      { clientId: "c1", kind: "expense" },
      principal,
    )) as { rows: unknown[]; totalCount: number };
    expect(out.rows).toHaveLength(50);
    expect(out.totalCount).toBe(51);
  });

  it("rejects a limit above the schema's cap of 200", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { expenses: [] } });
    await expect(
      byName("list_plan_details").run({ clientId: "c1", kind: "expense", limit: 500 }, principal),
    ).rejects.toBeTruthy();
  });

  it("passes scenarioId to loadEffectiveTree, defaulting to base", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { expenses: [] } });
    await byName("list_plan_details").run({ clientId: "c1", kind: "expense" }, principal);
    expect(loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "base", {});

    loadEffectiveTree.mockClear();
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { expenses: [] } });
    await byName("list_plan_details").run(
      { clientId: "c1", kind: "expense", scenarioId: "s99" },
      principal,
    );
    expect(loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "s99", {});
  });

  it("attaches a foundryUrl deep link to the net-worth detail page", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { accounts: [] } });
    const out = (await byName("list_plan_details").run(
      { clientId: "c1", kind: "account" },
      principal,
    )) as { foundryUrl: string };
    expect(out.foundryUrl).toBe(foundryUrl("c1", "netWorth"));
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(
      byName("list_plan_details").run({ clientId: "c1", kind: "account" }, principal),
    ).rejects.toThrow(DENIED_MESSAGE);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("carries read-only annotations and a real title", () => {
    const tool = byName("list_plan_details");
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.title).toMatch(/\S/);
    expect(tool.description).toMatch(/\S/);
  });

  // R43: each `kind` must read its OWN effectiveTree slice, not a
  // neighboring array copy-pasted from another entry in DETAIL_KINDS — and
  // family_member rows must come back with a birthYear, never the exact
  // dateOfBirth (a Phase-1 privacy gap the shared sanitizeRow does not
  // close: it redacts SSNs and masks accountNumber* keys, but does nothing
  // to a date of birth).
  const kindCases: Array<{
    kind: string;
    property: string;
    row: Record<string, unknown>;
    expectedRow: Record<string, unknown>;
  }> = [
    { kind: "account", property: "accounts", row: { id: "a1" }, expectedRow: { id: "a1" } },
    { kind: "income", property: "incomes", row: { id: "i1" }, expectedRow: { id: "i1" } },
    { kind: "expense", property: "expenses", row: { id: "e1" }, expectedRow: { id: "e1" } },
    { kind: "liability", property: "liabilities", row: { id: "l1" }, expectedRow: { id: "l1" } },
    { kind: "entity", property: "entities", row: { id: "en1" }, expectedRow: { id: "en1" } },
    { kind: "gift", property: "gifts", row: { id: "g1" }, expectedRow: { id: "g1" } },
    {
      kind: "family_member",
      property: "familyMembers",
      row: { id: "fm1", firstName: "Kid", dateOfBirth: "1990-06-15" },
      expectedRow: { id: "fm1", firstName: "Kid", birthYear: 1990 },
    },
    {
      kind: "external_beneficiary",
      property: "externalBeneficiaries",
      row: { id: "x1" },
      expectedRow: { id: "x1" },
    },
  ];

  it.each(kindCases)(
    "kind '$kind' reads effectiveTree.$property only, and is echoed back unchanged",
    async ({ kind, property, row, expectedRow }) => {
      loadEffectiveTree.mockResolvedValue({ effectiveTree: { [property]: [row] } });
      const out = (await byName("list_plan_details").run(
        { clientId: "c1", kind },
        principal,
      )) as { rows: Record<string, unknown>[]; kind: string };
      expect(out.rows).toEqual([expectedRow]);
      // `kind` in the output must echo what was REQUESTED, not a constant —
      // every case here but "account" would catch a hardcoded value.
      expect(out.kind).toBe(kind);
    },
  );

  it("strips an exact date of birth from every family_member row across a page, not just the first", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        familyMembers: [
          { id: "fm1", role: "child", firstName: "A", lastName: null, dateOfBirth: "2010-12-31" },
          { id: "fm2", role: "child", firstName: "B", lastName: null, dateOfBirth: null },
        ],
      },
    });
    const out = (await byName("list_plan_details").run(
      { clientId: "c1", kind: "family_member" },
      principal,
    )) as { rows: Record<string, unknown>[] };
    expect(out.rows).toEqual([
      { id: "fm1", role: "child", firstName: "A", lastName: null, birthYear: 2010 },
      { id: "fm2", role: "child", firstName: "B", lastName: null, birthYear: null },
    ]);
    expect(out.rows[0]).not.toHaveProperty("dateOfBirth");
  });
});

describe("get_insurance", () => {
  it("returns life and disability policies by value, with names resolved and a deep link", async () => {
    getClientWithContacts.mockResolvedValue({
      firstName: "John", lastName: "Smith", spouseFirstName: "Susan", spouseLastName: "Smith",
    });
    const policies = [
      {
        accountId: "a1", name: "Term Life", policyType: "term", ownerLabel: "John Smith",
        insuredLabel: "John Smith", insuredPerson: "client", deathBenefit: 1_000_000,
        cashValue: 0, premiumAmount: 1200, termExpiryYear: 2040, carrier: "ACME", beneficiaries: [],
      },
    ];
    loadLifeInsuranceInventory.mockResolvedValue({ policies });
    const disability = [{ id: "d1", name: "LTD", insured: "client" }];
    loadDisabilityPolicies.mockResolvedValue(disability);

    const out = await byName("get_insurance").run({ clientId: "c1" }, principal);

    expect(loadLifeInsuranceInventory).toHaveBeenCalledWith("c1", "org_1", "John Smith", "Susan Smith");
    // loadDisabilityPolicies "takes no firmId and trusts its caller" — prove
    // exactly one argument reaches it, so a firmId can never be smuggled in.
    expect(loadDisabilityPolicies).toHaveBeenCalledWith("c1");
    expect(loadDisabilityPolicies.mock.calls[0]).toHaveLength(1);
    expect(out).toEqual({
      lifePolicies: policies,
      lifePolicyCount: 1,
      disabilityPolicies: disability,
      disabilityPolicyCount: 1,
      foundryUrl: foundryUrl("c1", "insurance"),
    });
  });

  it("falls back to 'Client' and a null spouse name when contacts are missing", async () => {
    getClientWithContacts.mockResolvedValue(null);
    loadLifeInsuranceInventory.mockResolvedValue({ policies: [] });
    loadDisabilityPolicies.mockResolvedValue([]);
    const out = (await byName("get_insurance").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(loadLifeInsuranceInventory).toHaveBeenCalledWith("c1", "org_1", "Client", null);
    expect(out.lifePolicyCount).toBe(0);
    expect(out.disabilityPolicyCount).toBe(0);
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("get_insurance").run({ clientId: "c1" }, principal)).rejects.toThrow(
      DENIED_MESSAGE,
    );
    expect(loadLifeInsuranceInventory).not.toHaveBeenCalled();
    expect(loadDisabilityPolicies).not.toHaveBeenCalled();
  });

  it("carries read-only annotations and a real title", () => {
    const tool = byName("get_insurance");
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.title).toMatch(/\S/);
    expect(tool.description).toMatch(/\S/);
  });
});
