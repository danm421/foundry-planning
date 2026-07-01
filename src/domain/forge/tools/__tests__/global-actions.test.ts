import { describe, it, expect, vi, beforeEach } from "vitest";

const { listCrmHouseholds, createCrmHousehold } = vi.hoisted(() => ({
  listCrmHouseholds: vi.fn(),
  createCrmHousehold: vi.fn(),
}));
vi.mock("@/lib/crm/households", () => ({ listCrmHouseholds, getCrmHousehold: vi.fn(), createCrmHousehold }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_A") }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("../../custom-events", () => ({ emitNavigate: vi.fn(async () => {}) }));
vi.mock("@/lib/clients/create-client", () => ({ createClientForHousehold: vi.fn() }));
vi.mock("@/lib/crm-tasks/mutations", () => ({ createTask: vi.fn() }));

import { buildGlobalActionTools } from "../global-actions";
import { getCrmHousehold } from "@/lib/crm/households";
import { emitNavigate } from "../../custom-events";
import { recordAudit } from "@/lib/audit";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { createTask } from "@/lib/crm-tasks/mutations";

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

describe("set_up_plan (HITL)", () => {
  const household = {
    id: "hh_1", advisorId: "user_1", state: "NJ", planningClient: null,
    contacts: [{ role: "primary", firstName: "Jane", lastName: "Doe", dateOfBirth: null }],
  };
  it("creates the plan from the household's primary contact + model-supplied planning fields", async () => {
    (getCrmHousehold as any).mockResolvedValue(household);
    (createClientForHousehold as any).mockResolvedValue({ clientId: "client_9", scenarioId: "base" });
    const out = JSON.parse(String(await getTool("set_up_plan").invoke({
      householdId: "hh_1", retirementAge: 65, lifeExpectancy: 95,
      filingStatus: "married_joint", primaryDob: "1970-05-15",
    })));
    expect(createClientForHousehold).toHaveBeenCalledWith(expect.objectContaining({
      household: { id: "hh_1", firmId: "org_A", advisorId: "user_1", state: "NJ" },
      primaryContact: { firstName: "Jane", lastName: "Doe", dateOfBirth: "1970-05-15" },
      retirementAge: 65, lifeExpectancy: 95, filingStatus: "married_joint",
    }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "forge.write_approved", resourceType: "client", resourceId: "client_9",
    }));
    expect(emitNavigate).toHaveBeenCalledWith("/clients/client_9");
    expect(out).toEqual({ clientId: "client_9" });
  });
  it("refuses when the household already has a plan", async () => {
    (getCrmHousehold as any).mockResolvedValue({ ...household, planningClient: { id: "client_x" } });
    const out = String(await getTool("set_up_plan").invoke({
      householdId: "hh_1", retirementAge: 65, lifeExpectancy: 95, filingStatus: "single", primaryDob: "1970-05-15",
    }));
    expect(out).toMatch(/already has a plan/i);
    expect(createClientForHousehold).not.toHaveBeenCalled();
  });
  it("rejects a wrong-firm household (IDOR)", async () => {
    (getCrmHousehold as any).mockResolvedValue(undefined);
    const out = String(await getTool("set_up_plan").invoke({
      householdId: "hh_evil", retirementAge: 65, lifeExpectancy: 95, filingStatus: "single", primaryDob: "1970-05-15",
    }));
    expect(out).toMatch(/not found/i);
    expect(createClientForHousehold).not.toHaveBeenCalled();
  });
});

describe("create_task_for_client (HITL)", () => {
  it("creates a household-scoped task after an IDOR check", async () => {
    (getCrmHousehold as any).mockResolvedValue({ id: "hh_1", planningClient: null, contacts: [] });
    (createTask as any).mockResolvedValue({ id: "task_5", title: "Call Jane" });
    const out = JSON.parse(String(await getTool("create_task_for_client").invoke({
      householdId: "hh_1", title: "Call Jane", priority: "high", dueDate: "2026-07-15",
    })));
    expect(createTask).toHaveBeenCalledWith("org_A", "user_1", expect.objectContaining({
      title: "Call Jane", priority: "high", dueDate: "2026-07-15", householdId: "hh_1",
    }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "forge.write_approved", resourceType: "crm_task", resourceId: "task_5",
    }));
    expect(out).toEqual({ taskId: "task_5", title: "Call Jane" });
  });
  it("rejects a wrong-firm household (IDOR) before createTask", async () => {
    (getCrmHousehold as any).mockResolvedValue(undefined);
    const out = String(await getTool("create_task_for_client").invoke({ householdId: "hh_evil", title: "x" }));
    expect(out).toMatch(/not found/i);
    expect(createTask).not.toHaveBeenCalled();
  });
});
