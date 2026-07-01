import { describe, it, expect, vi, beforeEach } from "vitest";

const { listCrmHouseholds, createCrmHousehold } = vi.hoisted(() => ({
  listCrmHouseholds: vi.fn(),
  createCrmHousehold: vi.fn(),
}));
vi.mock("@/lib/crm/households", () => ({ listCrmHouseholds, getCrmHousehold: vi.fn(), createCrmHousehold }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_A") }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("../../custom-events", () => ({ emitNavigate: vi.fn(async () => {}) }));

import { buildGlobalActionTools } from "../global-actions";
import { getCrmHousehold } from "@/lib/crm/households";
import { emitNavigate } from "../../custom-events";
import { recordAudit } from "@/lib/audit";

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

describe("open_client", () => {
  it("navigates to the plan when the household has one", async () => {
    (getCrmHousehold as any).mockResolvedValue({ id: "hh_1", planningClient: { id: "client_9" }, contacts: [] });
    const out = JSON.parse(String(await getTool("open_client").invoke({ householdId: "hh_1" })));
    expect(getCrmHousehold).toHaveBeenCalledWith("hh_1");
    expect(emitNavigate).toHaveBeenCalledWith("/clients/client_9");
    expect(out.navigated).toBe(true);
  });

  it("navigates to the CRM household page when there is no plan yet", async () => {
    (getCrmHousehold as any).mockResolvedValue({ id: "hh_2", planningClient: null, contacts: [] });
    await getTool("open_client").invoke({ householdId: "hh_2" });
    expect(emitNavigate).toHaveBeenCalledWith("/crm/households/hh_2");
  });

  it("returns an error for a wrong-firm / missing household (IDOR)", async () => {
    (getCrmHousehold as any).mockResolvedValue(undefined);
    const out = String(await getTool("open_client").invoke({ householdId: "hh_evil" }));
    expect(out).toMatch(/not found/i);
    expect(emitNavigate).not.toHaveBeenCalled();
  });
});

describe("create_household (HITL)", () => {
  it("creates via createCrmHousehold with advisorId forced to ctx.userId, audits, and navigates", async () => {
    (createCrmHousehold as any).mockResolvedValue({ id: "hh_new", name: "Doe Household" });
    const out = JSON.parse(String(await getTool("create_household").invoke({
      name: "Doe Household",
      state: "NJ",
      primaryContact: { firstName: "Jane", lastName: "Doe", dob: "1970-05-15" },
    })));
    expect(createCrmHousehold).toHaveBeenCalledWith(expect.objectContaining({
      name: "Doe Household",
      advisorId: "user_1", // ctx.userId — NOT model-supplied
      state: "NJ",
      contacts: [{ role: "primary", firstName: "Jane", lastName: "Doe", dateOfBirth: "1970-05-15" }],
    }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "forge.write_approved", resourceType: "crm_household", resourceId: "hh_new",
    }));
    expect(emitNavigate).toHaveBeenCalledWith("/crm/households/hh_new");
    expect(out).toEqual({ householdId: "hh_new", name: "Doe Household", suggestion: "set_up_plan" });
  });
});
