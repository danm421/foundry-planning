import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "org_A") }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/crm-tasks/queries", () => ({
  listTasks: vi.fn(),
  getTaskById: vi.fn(),
  listTaskComments: vi.fn(),
  listTaskActivity: vi.fn(),
  listTaskFiles: vi.fn(),
}));
vi.mock("@/lib/crm-tasks/mutations", () => ({
  createTask: vi.fn(),
  updateTaskField: vi.fn(),
  setTaskStatus: vi.fn(),
  postComment: vi.fn(),
  deleteTask: vi.fn(),
}));
vi.mock("@/lib/crm-tasks/members", () => ({
  listFirmMembers: vi.fn(async () => [
    { userId: "user_1", displayName: "Dan Advisor", email: "dan@firm.com", imageUrl: null },
    { userId: "user_2", displayName: "Sue Planner", email: "sue@firm.com", imageUrl: null },
  ]),
}));

import { buildGlobalTaskTools } from "../global-tasks";
import { requireOrgId } from "@/lib/db-helpers";
import {
  listTasks, getTaskById, listTaskComments, listTaskActivity, listTaskFiles,
} from "@/lib/crm-tasks/queries";

const toolCtx = { ctx: { userId: "user_1", firmId: "org_A" }, conversationId: "conv_1" };
function getTool(name: string) {
  const t = buildGlobalTaskTools(toolCtx).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not built`);
  return t;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "task_1", title: "Call the Coopers", status: "open", priority: "med",
  dueDate: "2026-07-15", householdId: "hh_1", householdName: "Cooper & Susan Sample",
  assigneeUserId: "user_2", recurrence: "none", commentCount: 1, fileCount: 0,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("tasks_list", () => {
  it("lists firm-wide (no household scope) and resolves assignee display names", async () => {
    vi.mocked(listTasks).mockResolvedValue([row()] as never);
    const out = JSON.parse(String(await getTool("tasks_list").invoke({ status: ["open"] })));
    expect(listTasks).toHaveBeenCalledWith(
      "org_A",
      { householdId: undefined, priority: undefined },
      { status: ["open"], overdueOnly: false, assigneeUserId: null },
    );
    expect(out.tasks[0].assigneeName).toBe("Sue Planner");
    expect(out.totalCount).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it("resolves assignee 'me' to ctx.userId", async () => {
    vi.mocked(listTasks).mockResolvedValue([] as never);
    await getTool("tasks_list").invoke({ assignee: "me" });
    expect(listTasks).toHaveBeenCalledWith(
      "org_A",
      { householdId: undefined, priority: undefined },
      { status: null, overdueOnly: false, assigneeUserId: "user_1" },
    );
  });

  it("post-filters 'unassigned' to rows with no assignee", async () => {
    vi.mocked(listTasks).mockResolvedValue([
      row({ id: "t_a", assigneeUserId: null }),
      row({ id: "t_b", assigneeUserId: "user_2" }),
    ] as never);
    const out = JSON.parse(String(await getTool("tasks_list").invoke({ assignee: "unassigned" })));
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0].id).toBe("t_a");
  });

  it("caps at 100 rows and flags truncation", async () => {
    vi.mocked(listTasks).mockResolvedValue(
      Array.from({ length: 120 }, (_, i) => row({ id: `t_${i}` })) as never,
    );
    const out = JSON.parse(String(await getTool("tasks_list").invoke({})));
    expect(out.tasks).toHaveLength(100);
    expect(out.totalCount).toBe(120);
    expect(out.truncated).toBe(true);
  });

  it("returns an error STRING when requireOrgId throws", async () => {
    vi.mocked(requireOrgId).mockRejectedValueOnce(new Error("No organization selected"));
    const out = String(await getTool("tasks_list").invoke({}));
    expect(out).toMatch(/No organization selected/);
    expect(listTasks).not.toHaveBeenCalled();
  });
});

describe("tasks_detail", () => {
  it("returns task + tags + comments + activity + file names with resolved names", async () => {
    vi.mocked(getTaskById).mockResolvedValue({
      task: { id: "task_1", title: "Call the Coopers", householdId: "hh_1", assigneeUserId: "user_2", description: "" },
      tags: [{ id: "tag_1", label: "compliance", color: "gold" }],
    } as never);
    vi.mocked(listTaskComments).mockResolvedValue([
      { id: "cm_1", taskId: "task_1", authorUserId: "user_1", bodyMarkdown: "Left a voicemail.", createdAt: "2026-07-01" },
    ] as never);
    vi.mocked(listTaskActivity).mockResolvedValue([
      { id: "ac_1", taskId: "task_1", userId: "user_1", kind: "created", payload: {}, createdAt: "2026-06-20" },
    ] as never);
    vi.mocked(listTaskFiles).mockResolvedValue([
      { id: "f_1", taskId: "task_1", filename: "adv-2b.pdf", storageKey: "SECRET", uploadedAt: "2026-06-21" },
    ] as never);
    const out = JSON.parse(String(await getTool("tasks_detail").invoke({ taskId: "task_1" })));
    expect(getTaskById).toHaveBeenCalledWith("task_1", "org_A");
    expect(out.task.assigneeName).toBe("Sue Planner");
    expect(out.comments[0].authorName).toBe("Dan Advisor");
    expect(out.comments[0].bodyMarkdown).toBe("Left a voicemail.");
    expect(out.activity[0].userName).toBe("Dan Advisor");
    expect(out.files[0]).toEqual({ id: "f_1", filename: "adv-2b.pdf", uploadedAt: "2026-06-21" });
    expect(JSON.stringify(out.files)).not.toContain("SECRET"); // storage keys never leak
  });

  it("returns an error for a wrong-firm / missing task (IDOR)", async () => {
    vi.mocked(getTaskById).mockResolvedValue(null);
    const out = String(await getTool("tasks_detail").invoke({ taskId: "task_evil" }));
    expect(out).toMatch(/not found/i);
    expect(listTaskComments).not.toHaveBeenCalled();
  });
});

describe("firm_members", () => {
  it("lists members without imageUrl", async () => {
    const out = JSON.parse(String(await getTool("firm_members").invoke({})));
    expect(out.members).toEqual([
      { userId: "user_1", displayName: "Dan Advisor", email: "dan@firm.com" },
      { userId: "user_2", displayName: "Sue Planner", email: "sue@firm.com" },
    ]);
  });
});
