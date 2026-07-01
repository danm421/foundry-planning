import { describe, it, expect, vi, beforeEach } from "vitest";

const { listCrmHouseholds } = vi.hoisted(() => ({ listCrmHouseholds: vi.fn() }));
vi.mock("@/lib/crm/households", () => ({ listCrmHouseholds, getCrmHousehold: vi.fn() }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_A") }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("../custom-events", () => ({ emitNavigate: vi.fn(async () => {}) }));

import { buildGlobalActionTools } from "../global-actions";

const toolCtx = { ctx: { userId: "user_1", firmId: "org_A" }, conversationId: "conv_1" };
function getTool(name: string) {
  const t = buildGlobalActionTools(toolCtx).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not built`);
  return t;
}

beforeEach(() => vi.clearAllMocks());

describe("find_client", () => {
  it("maps firm-scoped household search to matches", async () => {
    listCrmHouseholds.mockResolvedValue([
      { id: "hh_1", name: "Doe", status: "active", contacts: [], planningClient: { id: "client_9" } },
      { id: "hh_2", name: "Doebler", status: "prospect", contacts: [], planningClient: null },
    ]);
    const out = JSON.parse(String(await getTool("find_client").invoke({ query: "doe" })));
    expect(listCrmHouseholds).toHaveBeenCalledWith({ search: "doe", limit: 10 });
    expect(out.matches).toEqual([
      { name: "Doe", householdId: "hh_1", clientId: "client_9", status: "active" },
      { name: "Doebler", householdId: "hh_2", clientId: null, status: "prospect" },
    ]);
  });
});
