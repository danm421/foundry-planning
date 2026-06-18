import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgId = vi.fn();
const verifyClientAccess = vi.fn();
const clientToHousehold = vi.fn();
const listHouseholdNotes = vi.fn();
const listActivity = vi.fn();
const listTasks = vi.fn();
const listOpenItemsForClient = vi.fn();
const getHouseholdCard = vi.fn();
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: () => requireOrgId() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: (c: string) => verifyClientAccess(c) }));
vi.mock("../guards", async (orig) => ({ ...(await orig()), clientToHousehold: (c: string, f: string) => clientToHousehold(c, f) }));
vi.mock("@/lib/crm/notes", () => ({ listHouseholdNotes: (h: string, f: string) => listHouseholdNotes(h, f) }));
vi.mock("@/lib/crm/activity", () => ({ listActivity: (h: string, o: unknown) => listActivity(h, o) }));
vi.mock("@/lib/crm-tasks/queries", () => ({ listTasks: (f: string, s: unknown, fl: unknown) => listTasks(f, s, fl), getTaskById: vi.fn() }));
vi.mock("@/lib/overview/list-open-items", () => ({ listOpenItems: (c: string, f: string) => listOpenItemsForClient(c, f) }));
vi.mock("@/lib/crm/households", async (orig) => ({ ...(await orig()), getCrmHousehold: (h: string) => getHouseholdCard(h) }));

import { buildCrmTools } from "../tools/crm";
import { buildToolContext } from "../context";

const ctx = { userId: "u1", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const tctx = buildToolContext(ctx, "conv-1");
const byName = (n: string) => buildCrmTools(tctx).find((t) => t.name === n)!;

beforeEach(() => {
  requireOrgId.mockResolvedValue("org_A");
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_A", access: "own" });
  clientToHousehold.mockResolvedValue("hh-1");
  listHouseholdNotes.mockReset();
  listActivity.mockReset();
  listTasks.mockReset();
  listOpenItemsForClient.mockReset();
  getHouseholdCard.mockReset();
});

describe("crm_recent_notes", () => {
  it("resolves the household and returns recent notes for it", async () => {
    listHouseholdNotes.mockResolvedValue([{ id: "n1", subject: "Met", noteKind: "meeting", noteDate: "2026-06-01", body: "ok" }]);
    const out = JSON.parse(await byName("crm_recent_notes").invoke({ limit: 5 }));
    expect(listHouseholdNotes).toHaveBeenCalledWith("hh-1", "org_A");
    expect(out.notes[0].id).toBe("n1");
  });
  it("returns an error STRING (never throws) when access is denied", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    const out = await byName("crm_recent_notes").invoke({ limit: 5 });
    expect(out).toMatch(/not found or access denied/i);
    expect(listHouseholdNotes).not.toHaveBeenCalled();
  });
});

describe("crm_activity_feed", () => {
  it("returns the household timeline scoped to the resolved household", async () => {
    listActivity.mockResolvedValue([{ id: "a1", kind: "meeting", title: "Annual review", occurredAt: "2026-06-01" }]);
    const out = JSON.parse(await byName("crm_activity_feed").invoke({ limit: 20 }));
    expect(listActivity).toHaveBeenCalledWith("hh-1", { limit: 20 });
    expect(out.activity[0].id).toBe("a1");
  });
});

describe("crm_list_tasks", () => {
  it("merges household crm_tasks with planning-side open items", async () => {
    listTasks.mockResolvedValue([{ id: "t1", title: "Send IPS", status: "open", dueDate: "2026-06-20", householdId: "hh-1" }]);
    listOpenItemsForClient.mockResolvedValue([{ id: "oi1", label: "Gather statements", status: "open" }]);
    const out = JSON.parse(await byName("crm_list_tasks").invoke({ status: ["open"], overdueOnly: false }));
    expect(listTasks).toHaveBeenCalledWith("org_A", { householdId: "hh-1" }, expect.objectContaining({ status: ["open"], overdueOnly: false }));
    expect(out.tasks).toHaveLength(1);
    expect(out.openItems).toHaveLength(1);
  });
});

describe("crm_client_card", () => {
  it("returns contacts + dates but masks SSN to last-4 and drops metadata jsonb", async () => {
    getHouseholdCard.mockResolvedValue({
      name: "The Smiths", status: "active", advisorId: "adv-1",
      contacts: [{ role: "primary", firstName: "Sam", lastName: "Smith", dateOfBirth: "1960-04-01", ssnLast4: "1234", metadata: { secret: "x" } }],
    });
    const out = JSON.parse(await byName("crm_client_card").invoke({}));
    expect(out.contacts[0].ssn).toBe("•••-••-1234");
    expect(out.contacts[0]).not.toHaveProperty("ssnLast4");
    expect(out.contacts[0]).not.toHaveProperty("metadata");
  });
});
