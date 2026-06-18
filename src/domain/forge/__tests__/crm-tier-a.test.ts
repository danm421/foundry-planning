import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgId = vi.fn();
const verifyClientAccess = vi.fn();
const clientToHousehold = vi.fn();
const createNote = vi.fn();
const recordActivity = vi.fn();
const createTask = vi.fn();
const updateTaskField = vi.fn();
const setTaskStatus = vi.fn();
const postComment = vi.fn();
const getTaskById = vi.fn();
const recordAudit = vi.fn();

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: () => requireOrgId() }));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (c: string) => verifyClientAccess(c),
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
  updateTaskField: (tid: string, fid: string, uid: string, u: unknown) => updateTaskField(tid, fid, uid, u),
  setTaskStatus: (tid: string, fid: string, uid: string, s: unknown) => setTaskStatus(tid, fid, uid, s),
  postComment: (tid: string, fid: string, uid: string, b: string) => postComment(tid, fid, uid, b),
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
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "org_A", access: "own" });
  clientToHousehold.mockResolvedValue("hh-1");
  createNote.mockReset();
  recordActivity.mockReset();
  createTask.mockReset();
  updateTaskField.mockReset();
  setTaskStatus.mockReset();
  postComment.mockReset();
  getTaskById.mockReset();
  recordAudit.mockReset();
});

describe("crm_create_task (Tier A)", () => {
  it("creates task with householdId forced from gate (never from model) and fires forge.tool_call", async () => {
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
      expect.objectContaining({ action: "forge.tool_call", resourceType: "crm_task", resourceId: "t1" }),
    );
    expect(out.task.id).toBe("t1");
  });

  it("returns an error string when access is denied", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    const out = await byName("crm_create_task").invoke({ title: "x" });
    expect(out).toMatch(/access denied/i);
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe("crm_log_activity (Tier A)", () => {
  it("records activity with actorUserId=ctx.userId and fires forge.tool_call", async () => {
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
        action: "forge.tool_call",
        resourceType: "crm_activity",
        resourceId: "hh-1",
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.kind).toBe("call");
  });

  it("returns an error string when access is denied", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    const out = await byName("crm_log_activity").invoke({ kind: "call", title: "test" });
    expect(out).toMatch(/access denied/i);
    expect(recordActivity).not.toHaveBeenCalled();
  });
});

describe("crm_add_note (Tier A)", () => {
  it("creates a note with actorUserId=ctx.userId and fires forge.tool_call", async () => {
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
        action: "forge.tool_call",
        resourceType: "crm_note",
        resourceId: "n1",
      }),
    );
    expect(out.note.id).toBe("n1");
  });

  it("returns an error string and does NOT write when access is denied", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    const out = await byName("crm_add_note").invoke({
      subject: "x",
      noteDate: "2026-06-15",
    });
    expect(out).toMatch(/access denied/i);
    expect(createNote).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("crm_update_task (Tier A, ownership-gated)", () => {
  it("updates a task field when ownership passes and fires forge.tool_call", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t1", householdId: "hh-1" }, tags: [] });
    updateTaskField.mockResolvedValue({ id: "t1", title: "Updated title" });
    const out = JSON.parse(
      await byName("crm_update_task").invoke({ taskId: "t1", field: "title", value: "Updated title" }),
    );
    expect(updateTaskField).toHaveBeenCalledWith(
      "t1", "org_A", "advisor-9",
      expect.objectContaining({ field: "title", value: "Updated title" }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.tool_call", resourceType: "crm_task", resourceId: "t1" }),
    );
    expect(out.task.id).toBe("t1");
  });

  it("IDOR: same-firm task in another household → updateTaskField NEVER called", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t9", householdId: "hh-OTHER" }, tags: [] });
    const out = await byName("crm_update_task").invoke({ taskId: "t9", field: "title", value: "x" });
    expect(out).toMatch(/does not belong to this client/i);
    expect(updateTaskField).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("crm_complete_task (Tier A, ownership-gated)", () => {
  it("sets task status and returns followOnId when ownership passes", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t1", householdId: "hh-1" }, tags: [] });
    setTaskStatus.mockResolvedValue({ task: { id: "t1", status: "done" }, followOnId: "t2" });
    const out = JSON.parse(
      await byName("crm_complete_task").invoke({ taskId: "t1", status: "done" }),
    );
    expect(setTaskStatus).toHaveBeenCalledWith("t1", "org_A", "advisor-9", "done");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.tool_call", resourceType: "crm_task", resourceId: "t1" }),
    );
    expect(out.task.status).toBe("done");
    expect(out.followOnId).toBe("t2");
  });

  it("IDOR: same-firm task in another household → setTaskStatus NEVER called", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t9", householdId: "hh-OTHER" }, tags: [] });
    const out = await byName("crm_complete_task").invoke({ taskId: "t9" });
    expect(out).toMatch(/does not belong to this client/i);
    expect(setTaskStatus).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("crm_post_task_comment (Tier A, ownership-gated)", () => {
  it("posts a comment with authorUserId=ctx.userId and fires forge.tool_call", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t1", householdId: "hh-1" }, tags: [] });
    postComment.mockResolvedValue({ id: "c1", bodyMarkdown: "Great progress!" });
    const out = JSON.parse(
      await byName("crm_post_task_comment").invoke({ taskId: "t1", body: "Great progress!" }),
    );
    expect(postComment).toHaveBeenCalledWith("t1", "org_A", "advisor-9", "Great progress!");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.tool_call", resourceType: "crm_task", resourceId: "t1" }),
    );
    expect(out.ok).toBe(true);
  });

  it("IDOR: same-firm task in another household → postComment NEVER called", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t9", householdId: "hh-OTHER" }, tags: [] });
    const out = await byName("crm_post_task_comment").invoke({ taskId: "t9", body: "comment" });
    expect(out).toMatch(/does not belong to this client/i);
    expect(postComment).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
