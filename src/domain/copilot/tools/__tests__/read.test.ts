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
