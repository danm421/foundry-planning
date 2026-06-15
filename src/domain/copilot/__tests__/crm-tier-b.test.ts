// src/domain/copilot/__tests__/crm-tier-b.test.ts
//
// Tier-B CRM destructive / bulk write tools: crm_delete_note, crm_delete_task,
// crm_create_tasks. These route through HITL approval (WRITE_TOOL_NAMES). The
// tool body runs only AFTER interrupt() on resume. The tool fires
// copilot.write_approved (never copilot.tool_call) on real persisted success.
// The node owns write_proposed / write_rejected.
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgId = vi.fn();
const verifyClientAccess = vi.fn();
const clientToHousehold = vi.fn();
const listHouseholdNotes = vi.fn();
const deleteNote = vi.fn();
const getTaskById = vi.fn();
const deleteTask = vi.fn();
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
  createNote: vi.fn(),
  listHouseholdNotes: (...a: unknown[]) => listHouseholdNotes(...a),
  deleteNote: (...a: unknown[]) => deleteNote(...a),
}));
vi.mock("@/lib/crm/activity", () => ({
  recordActivity: vi.fn(),
  listActivity: vi.fn(),
}));
vi.mock("@/lib/crm-tasks/mutations", () => ({
  createTask: (f: string, u: string, i: unknown) => createTask(f, u, i),
  updateTaskField: vi.fn(),
  setTaskStatus: vi.fn(),
  postComment: vi.fn(),
  deleteTask: (tid: string, fid: string) => deleteTask(tid, fid),
}));
vi.mock("@/lib/crm-tasks/queries", () => ({
  getTaskById: (t: string, f: string) => getTaskById(t, f),
  listTasks: vi.fn(),
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
  listHouseholdNotes.mockReset();
  deleteNote.mockReset();
  getTaskById.mockReset();
  deleteTask.mockReset();
  createTask.mockReset();
  recordAudit.mockReset();
});

describe("crm_create_tasks (Tier B, bulk)", () => {
  it("creates all tasks household-stamped and fires ONE write_approved with count", async () => {
    createTask
      .mockResolvedValueOnce({ id: "t1" })
      .mockResolvedValueOnce({ id: "t2" })
      .mockResolvedValueOnce({ id: "t3" });
    const out = JSON.parse(
      await byName("crm_create_tasks").invoke({
        tasks: [
          { title: "Task A" },
          { title: "Task B" },
          { title: "Task C" },
        ],
      }),
    );
    expect(createTask).toHaveBeenCalledTimes(3);
    expect(createTask).toHaveBeenCalledWith("org_A", "advisor-9", expect.objectContaining({ householdId: "hh-1", title: "Task A" }));
    expect(createTask).toHaveBeenCalledWith("org_A", "advisor-9", expect.objectContaining({ householdId: "hh-1", title: "Task B" }));
    expect(createTask).toHaveBeenCalledWith("org_A", "advisor-9", expect.objectContaining({ householdId: "hh-1", title: "Task C" }));
    // One write_approved audit, count=3
    const auditCalls = recordAudit.mock.calls.filter(
      (c: [unknown]) => (c[0] as { action: string }).action === "copilot.write_approved",
    );
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0][0]).toMatchObject({ metadata: { count: 3 } });
    expect(out.created).toBe(3);
    expect(out.ids).toEqual(["t1", "t2", "t3"]);
  });

  it("returns an error string and creates nothing when tasks exceed the hard cap (>25)", async () => {
    const tasks = Array.from({ length: 26 }, (_, i) => ({ title: `Task ${i + 1}` }));
    const out = await byName("crm_create_tasks").invoke({ tasks });
    expect(out).toMatch(/exceed/i);
    expect(createTask).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "copilot.write_approved" }));
  });
});

describe("crm_delete_task (Tier B)", () => {
  it("deletes the task (household-checked) and fires copilot.write_approved on success", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t1", householdId: "hh-1" }, tags: [] });
    deleteTask.mockResolvedValue(undefined);
    const out = JSON.parse(await byName("crm_delete_task").invoke({ taskId: "t1" }));
    expect(deleteTask).toHaveBeenCalledWith("t1", "org_A");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "copilot.write_approved", resourceType: "crm_task", resourceId: "t1" }));
    expect(out.ok).toBe(true);
  });

  it("rejects a task from another household (IDOR) and does NOT delete or audit-approve", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t1", householdId: "hh-OTHER" }, tags: [] });
    const out = await byName("crm_delete_task").invoke({ taskId: "t1" });
    expect(out).toMatch(/does not belong to this client/i);
    expect(deleteTask).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "copilot.write_approved" }));
  });
});

describe("crm_delete_note (Tier B)", () => {
  it("deletes the note and fires copilot.write_approved on real success", async () => {
    listHouseholdNotes.mockResolvedValue([{ id: "n1" }]);
    deleteNote.mockResolvedValue(undefined);
    const out = JSON.parse(await byName("crm_delete_note").invoke({ noteId: "n1" }));
    expect(deleteNote).toHaveBeenCalledWith("n1", "hh-1", "org_A", "advisor-9");
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "copilot.write_approved", resourceType: "crm_note", resourceId: "n1" }));
    expect(out.ok).toBe(true);
  });

  it("rejects a note from another household (IDOR) and does NOT delete or audit-approve", async () => {
    listHouseholdNotes.mockResolvedValue([{ id: "n-other" }]); // n1 not present
    const out = await byName("crm_delete_note").invoke({ noteId: "n1" });
    expect(out).toMatch(/not found for this client/i);
    expect(deleteNote).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "copilot.write_approved" }));
  });
});
