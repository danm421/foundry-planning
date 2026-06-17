// src/domain/copilot/tools/__tests__/read.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks -----------------------------------------------------------------
// firmId is re-derived server-side, never trusted from the model. Pin it to
// the ctx firmId so the search assertion is stable.
const requireOrgId = vi.fn<() => Promise<string>>();
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: () => requireOrgId() }));

const searchClients =
  vi.fn<(query: string, firmId: string) => Promise<{ id: string; householdTitle: string }[]>>();
vi.mock("@/lib/client-search", () => ({
  searchClients: (q: string, f: string) => searchClients(q, f),
}));

const getOverviewData = vi.fn();
vi.mock("@/lib/overview/get-overview-data", () => ({
  getOverviewData: (...a: unknown[]) => getOverviewData(...a),
}));

const getClientWithContacts = vi.fn();
vi.mock("@/lib/clients/get-client-with-contacts", () => ({
  getClientWithContacts: (...a: unknown[]) => getClientWithContacts(...a),
}));

// db.select({...}).from(scenarios).where(eq(...)) → resolves the scenario roster.
const dbWhere = vi.fn();
vi.mock("@/db", () => {
  const where = (...a: unknown[]) => dbWhere(...a);
  const from = () => ({ where });
  const select = () => ({ from });
  return {
    db: { select },
  };
});
// drizzle-orm eq is called inside the tool; pass it through harmlessly.
vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, eq: (...a: unknown[]) => ({ __eq: a }) };
});
vi.mock("@/db/schema", () => ({
  scenarios: { id: "id", name: "name", isBaseCase: "isBaseCase", clientId: "clientId" },
}));

const loadPanelData = vi.fn();
vi.mock("@/lib/scenario/load-panel-data", () => ({
  loadPanelData: (...a: unknown[]) => loadPanelData(...a),
}));

const loadEffectiveTree = vi.fn();
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: (...a: unknown[]) => loadEffectiveTree(...a),
}));

// The guard is async; the mock enforces clientId === ctx.clientId so the
// rejection path is exercised without a DB round-trip.
vi.mock("../../guards", () => {
  class ForbiddenScopeError extends Error {
    constructor(detail: string) {
      super(`forbidden_scope: ${detail}`);
      this.name = "ForbiddenScopeError";
    }
  }
  return {
    ForbiddenScopeError,
    assertClientReadable: async (
      ctx: { clientId: string },
      clientId: string,
    ): Promise<void> => {
      if (clientId !== ctx.clientId) {
        throw new ForbiddenScopeError(`client ${clientId}`);
      }
    },
  };
});

import { buildReadTools } from "../read";
import { buildToolContext } from "../../context";
import type { CopilotAuthContext } from "../../context";

const ctx: CopilotAuthContext = {
  userId: "u1",
  firmId: "firmA",
  clientId: "client-1",
  scenarioId: "base",
};

function tool(name: string) {
  const tools = buildReadTools(buildToolContext(ctx, "conv-1"));
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

beforeEach(() => {
  requireOrgId.mockReset();
  requireOrgId.mockResolvedValue("firmA");
  searchClients.mockReset();
  getOverviewData.mockReset();
  getOverviewData.mockRejectedValue(new Error("getOverviewData should not be called"));
  getClientWithContacts.mockReset();
  getClientWithContacts.mockRejectedValue(
    new Error("getClientWithContacts should not be called"),
  );
  dbWhere.mockReset();
  loadPanelData.mockReset();
  loadEffectiveTree.mockReset();
});

describe("read.ts — find_client", () => {
  it("searches the firm's roster and returns matching rows", async () => {
    const rows = [{ id: "client-1", householdTitle: "Doe, Jane & John" }];
    searchClients.mockResolvedValue(rows);

    const out = await tool("find_client").invoke({ query: "do" });

    expect(searchClients).toHaveBeenCalledWith("do", "firmA");
    expect(JSON.parse(out as string)).toEqual(rows);
  });
});

describe("read.ts — client_briefing", () => {
  it("rejects an out-of-scope clientId with forbidden_scope (no data read)", async () => {
    await expect(
      tool("client_briefing").invoke({ clientId: "client-OTHER" }),
    ).rejects.toThrow(/forbidden_scope/);
    expect(getOverviewData).not.toHaveBeenCalled();
  });

  it("returns a grounded snapshot for an in-scope client", async () => {
    getOverviewData.mockResolvedValue({
      kpi: { netWorth: 2_500_000, liquidPortfolio: 1_200_000, yearsToRetirement: 8 },
      runway: { netWorthSeries: [1, 2], minNetWorth: 900_000 },
      allocation: [{ type: "equity", value: 1_000_000 }],
      lifeEvents: [{ year: 2030, label: "Retirement" }],
      openItemsPreview: [{ id: "oi-1", title: "Upload statements" }],
      totalOpen: 3,
      alertInputs: { projectionError: "boom" },
      accountCount: 7,
    });
    getClientWithContacts.mockResolvedValue({
      firstName: "Jane",
      lastName: "Doe",
      spouseFirstName: "John",
      spouseLastName: "Doe",
    });

    const out = JSON.parse(
      (await tool("client_briefing").invoke({ clientId: "client-1" })) as string,
    );

    expect(getOverviewData).toHaveBeenCalledWith("client-1", "firmA", "base");
    expect(out.identity.primaryName).toBe("Jane Doe");
    expect(out.identity.spouseName).toBe("John Doe");
    expect(out.netWorth).toBe(2_500_000);
    expect(out.liquidPortfolio).toBe(1_200_000);
    expect(out.yearsToRetirement).toBe(8);
    expect(out.openItemCount).toBe(3);
    expect(out.accountCount).toBe(7);
    // projectionError is set, so projection-derived fields are suppressed.
    expect(out.projectionAvailable).toBe(false);
    expect(out.minProjectedNetWorth).toBeNull();
    expect(out.lifeEvents).toEqual([]);
  });
});

describe("read.ts — list_scenarios", () => {
  const roster = [
    { id: "scn-base", name: "Base Case", isBaseCase: true },
    { id: "scn-roth", name: "Roth Ladder", isBaseCase: false },
  ];

  it("rejects an out-of-scope clientId with forbidden_scope", async () => {
    await expect(
      tool("list_scenarios").invoke({ clientId: "client-OTHER" }),
    ).rejects.toThrow(/forbidden_scope/);
    expect(loadPanelData).not.toHaveBeenCalled();
  });

  it("lists the client's scenarios without drilling", async () => {
    dbWhere.mockResolvedValue(roster);

    const out = JSON.parse(
      (await tool("list_scenarios").invoke({ clientId: "client-1" })) as string,
    );

    expect(out.scenarios).toEqual(roster);
    expect(out.detail).toBeUndefined();
    expect(loadPanelData).not.toHaveBeenCalled();
  });

  it("drills into a scenario in the roster", async () => {
    dbWhere.mockResolvedValue(roster);
    loadPanelData.mockResolvedValue({
      scenarioId: "scn-roth",
      scenarioName: "Roth Ladder",
      changes: [{ id: "chg-1", opType: "edit" }],
      toggleGroups: [{ id: "tg-1", name: "Phase 1" }],
      cascadeWarnings: [],
      targetNames: {},
    });

    const out = JSON.parse(
      (await tool("list_scenarios").invoke({
        clientId: "client-1",
        scenarioId: "scn-roth",
      })) as string,
    );

    expect(loadPanelData).toHaveBeenCalledWith("client-1", "scn-roth", "firmA");
    expect(out.scenarios).toEqual(roster);
    expect(out.detail.scenarioId).toBe("scn-roth");
    expect(out.detail.changes).toHaveLength(1);
    expect(out.detail.toggleGroups).toHaveLength(1);
  });
});

describe("read.ts — read_detail", () => {
  it("rejects an out-of-scope clientId with forbidden_scope (no tree load)", async () => {
    await expect(
      tool("read_detail").invoke({ clientId: "client-OTHER", kind: "account" }),
    ).rejects.toThrow(/forbidden_scope/);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  // NOTE: the engine `Account` type (loadEffectiveTree output) carries no
  // account-number field today — `accountNumber` here is a forward/defense-in-
  // depth stand-in proving sanitizeRow masks any such field a future or
  // import-sourced payload might introduce. (The SSN case below is a real
  // vector: a CRM free-text field can carry a pasted SSN.)
  it("masks account numbers in account rows", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        accounts: [
          { id: "acc-1", name: "Brokerage", accountNumber: "9988776655", value: 100 },
        ],
      },
      warnings: [],
    });

    const raw = (await tool("read_detail").invoke({
      clientId: "client-1",
      kind: "account",
    })) as string;
    const out = JSON.parse(raw);

    expect(out.kind).toBe("account");
    expect(out.count).toBe(1);
    expect(out.rows[0].accountNumber).toBe("••••6655");
    // The full account number must never appear anywhere in the payload.
    expect(raw).not.toContain("9988776655");
  });

  it("masks a NUMERIC account-number field without crashing", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        accounts: [
          { id: "acc-2", name: "Checking", accountNumber: 9988776655, value: 200 },
        ],
      },
      warnings: [],
    });

    const raw = (await tool("read_detail").invoke({
      clientId: "client-1",
      kind: "account",
    })) as string;
    const out = JSON.parse(raw);

    expect(out.rows[0].accountNumber).toBe("••••6655");
    // The raw numeric value must never appear anywhere in the serialised payload.
    expect(raw).not.toContain("9988776655");
  });

  it("redacts an SSN that leaked into an income name", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        incomes: [{ id: "inc-1", name: "Salary 123-45-6789", amount: 50000 }],
      },
      warnings: [],
    });

    const raw = (await tool("read_detail").invoke({
      clientId: "client-1",
      kind: "income",
    })) as string;
    const out = JSON.parse(raw);

    expect(out.rows[0].name).toContain("[REDACTED-SSN]");
    expect(raw).not.toContain("123-45-6789");
  });
});
