import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { listOwnedConnections, getHouseholdLinkForClient } = vi.hoisted(() => ({
  listOwnedConnections: vi.fn(),
  getHouseholdLinkForClient: vi.fn(),
}));
vi.mock("./connections", () => ({ listOwnedConnections }));
vi.mock("./households", () => ({ getHouseholdLinkForClient }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
      }),
    }),
  },
}));

import { loadClientIntegrationStatus } from "./client-status";

const conn = (over: Record<string, unknown>) => ({
  id: "c1",
  providerId: "addepar",
  name: "Office key",
  status: "connected",
  lastSyncedAt: null,
  lastSyncError: null,
  linkedHouseholds: 0,
  ...over,
});
const own = { firmId: "firm_1", access: "own" as const };

const saved = process.env.ADDEPAR_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADDEPAR_ENABLED = "true";
  getHouseholdLinkForClient.mockResolvedValue(null);
  listOwnedConnections.mockResolvedValue([]);
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADDEPAR_ENABLED;
  else process.env.ADDEPAR_ENABLED = saved;
});

describe("loadClientIntegrationStatus", () => {
  it("is null for an unlinked client when the viewer has no connection", async () => {
    expect(await loadClientIntegrationStatus("cl", "user_1", own)).toBeNull();
  });

  it("reads the VIEWER's connections, scoped to firm and user", async () => {
    listOwnedConnections.mockResolvedValue([conn({})]);
    await loadClientIntegrationStatus("cl", "user_1", own);
    expect(listOwnedConnections).toHaveBeenCalledWith({ firmId: "firm_1", userId: "user_1" });
  });

  it("offers the unlinked affordance with the viewer's connections", async () => {
    listOwnedConnections.mockResolvedValue([conn({}), conn({ id: "c2", name: null })]);
    const s = await loadClientIntegrationStatus("cl", "user_1", own);
    expect(s).toMatchObject({ providerId: "addepar", providerLabel: "Addepar", canEdit: true, linked: false });
    expect(s?.connections).toEqual([
      { id: "c1", providerId: "addepar", providerLabel: "Addepar", name: "Office key" },
      { id: "c2", providerId: "addepar", providerLabel: "Addepar", name: "Addepar" },
    ]);
  });

  it("only connected + enabled + syncing providers count", async () => {
    listOwnedConnections.mockResolvedValue([
      conn({ id: "err", status: "error" }),
      conn({ id: "az", providerId: "azure_openai" }),
    ]);
    expect(await loadClientIntegrationStatus("cl", "user_1", own)).toBeNull();

    process.env.ADDEPAR_ENABLED = "false";
    listOwnedConnections.mockResolvedValue([conn({})]);
    expect(await loadClientIntegrationStatus("cl", "user_1", own)).toBeNull();
  });

  it("gives an edit-level SHARE no unlinked affordance", async () => {
    listOwnedConnections.mockResolvedValue([conn({})]);
    const s = await loadClientIntegrationStatus("cl", "user_1", { firmId: "firm_1", access: "shared" } as never);
    expect(s).toBeNull();
  });

  it("still renders the linked path for a shared caller, off the link alone", async () => {
    getHouseholdLinkForClient.mockResolvedValue({ provider: "addepar" });
    const s = await loadClientIntegrationStatus("cl", "user_1", { firmId: "firm_1", access: "shared" } as never);
    expect(s).toMatchObject({ providerId: "addepar", linked: true, canEdit: false });
  });
});
