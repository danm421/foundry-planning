import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgId = vi.fn();
const verifyClientAccess = vi.fn();
const clientToHousehold = vi.fn();
const createNote = vi.fn();
const recordActivity = vi.fn();
const createTask = vi.fn();
const recordAudit = vi.fn();

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: () => requireOrgId() }));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (c: string, f: string) => verifyClientAccess(c, f),
}));
vi.mock("../guards", async (o) => ({
  ...(await o()),
  clientToHousehold: (c: string, f: string) => clientToHousehold(c, f),
}));
vi.mock("@/lib/crm/notes", () => ({
  createNote: (...a: unknown[]) => createNote(...a),
  listHouseholdNotes: vi.fn(),
}));
vi.mock("@/lib/crm/activity", () => ({
  recordActivity: (i: unknown, o: unknown) => recordActivity(i, o),
  listActivity: vi.fn(),
}));
vi.mock("@/lib/crm-tasks/mutations", () => ({
  createTask: (f: string, u: string, i: unknown) => createTask(f, u, i),
  updateTaskField: vi.fn(),
  setTaskStatus: vi.fn(),
  postComment: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));

import { buildCrmTools } from "../tools/crm";
import { buildToolContext } from "../context";

const ctx = { userId: "advisor-9", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const byName = (n: string) =>
  buildCrmTools(buildToolContext(ctx, "conv-1")).find((t) => t.name === n)!;

beforeEach(() => {
  requireOrgId.mockResolvedValue("org_A");
  verifyClientAccess.mockResolvedValue(true);
  clientToHousehold.mockResolvedValue("hh-1");
  createNote.mockReset();
  recordActivity.mockReset();
  createTask.mockReset();
  recordAudit.mockReset();
});

describe("crm_create_task (Tier A)", () => {
  it("creates task with householdId forced from gate (never from model) and fires copilot.tool_call", async () => {
    createTask.mockResolvedValue({ id: "t1", title: "Send IPS", householdId: "hh-1", priority: "med", status: "open" });
    const out = JSON.parse(
      await byName("crm_create_task").invoke({
        title: "Send IPS",
        priority: "high",
        dueDate: "2026-07-01",
      }),
    );
    // actorUserId = ctx.userId, householdId forced from gate
    expect(createTask).toHaveBeenCalledWith(
      "org_A",
      "advisor-9",
      expect.objectContaining({ householdId: "hh-1", title: "Send IPS" }),
    );
    // householdId must NOT come from model (no householdId arg passed above → still "hh-1")
    const callArg = createTask.mock.calls[0][2];
    expect(callArg.householdId).toBe("hh-1");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.tool_call", resourceType: "crm_task", resourceId: "t1" }),
    );
    expect(out.task.id).toBe("t1");
  });

  it("returns an error string when access is denied", async () => {
    verifyClientAccess.mockResolvedValue(false);
    const out = await byName("crm_create_task").invoke({ title: "x" });
    expect(out).toMatch(/access denied/i);
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("crm_log_activity (Tier A)", () => {
  it("records activity with actorUserId=ctx.userId and fires copilot.tool_call", async () => {
    recordActivity.mockResolvedValue(undefined);
    const out = JSON.parse(
      await byName("crm_log_activity").invoke({
        kind: "call",
        title: "Quarterly check-in",
        body: "Reviewed allocation",
        occurredAt: "2026-06-15T10:00:00Z",
      }),
    );
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: "hh-1", kind: "call", title: "Quarterly check-in" }),
      { actorUserId: "advisor-9" },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.tool_call",
        resourceType: "crm_activity",
        resourceId: "hh-1",
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.kind).toBe("call");
  });

  it("returns an error string when access is denied", async () => {
    verifyClientAccess.mockResolvedValue(false);
    const out = await byName("crm_log_activity").invoke({ kind: "call", title: "test" });
    expect(out).toMatch(/access denied/i);
    expect(recordActivity).not.toHaveBeenCalled();
  });
});

describe("crm_add_note (Tier A)", () => {
  it("creates a note with actorUserId=ctx.userId and fires copilot.tool_call", async () => {
    createNote.mockResolvedValue({ id: "n1", subject: "Met with Sam", noteKind: "meeting" });
    const out = JSON.parse(
      await byName("crm_add_note").invoke({
        subject: "Met with Sam",
        body: "Discussed RMDs",
        noteKind: "meeting",
        noteDate: "2026-06-15",
      }),
    );
    expect(createNote).toHaveBeenCalledWith(
      "hh-1",
      "org_A",
      "advisor-9",
      expect.objectContaining({ subject: "Met with Sam", noteKind: "meeting" }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.tool_call",
        resourceType: "crm_note",
        resourceId: "n1",
      }),
    );
    expect(out.note.id).toBe("n1");
  });

  it("returns an error string and does NOT write when access is denied", async () => {
    verifyClientAccess.mockResolvedValue(false);
    const out = await byName("crm_add_note").invoke({
      subject: "x",
      noteDate: "2026-06-15",
    });
    expect(out).toMatch(/access denied/i);
    expect(createNote).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
