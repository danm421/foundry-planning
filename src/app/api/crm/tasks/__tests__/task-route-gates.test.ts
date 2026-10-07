// Every route that changes a task first checks the caller may see that task
// (requireCrmTaskAccess applies the CRM task rule), and a task can only be
// created on, or moved to, a household the caller may see.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "adv_me", orgRole: "org:member" })),
}));
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: vi.fn(async () => "org_1"),
}));
vi.mock("@/lib/crm/authz", () => ({
  requireCrmTaskAccess: vi.fn(),
  requireCrmHouseholdAccess: vi.fn(),
}));
vi.mock("@/lib/crm-tasks/mutations", () => ({
  createTask: vi.fn(async () => ({ id: "t_new" })),
  updateTaskField: vi.fn(async () => ({ id: "t1" })),
  deleteTask: vi.fn(),
  setTaskStatus: vi.fn(async () => ({ task: { id: "t1" }, followOnId: null })),
  attachTag: vi.fn(),
  detachTag: vi.fn(),
  postComment: vi.fn(async () => ({ id: "c1" })),
}));
vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: vi.fn(async () => []) }));

import { requireCrmHouseholdAccess, requireCrmTaskAccess } from "@/lib/crm/authz";
import * as mutations from "@/lib/crm-tasks/mutations";
import { POST as createRoute } from "../route";
import { PATCH as patchRoute, DELETE as deleteRoute } from "../[taskId]/route";
import { POST as statusRoute } from "../[taskId]/status/route";
import { POST as attachTagRoute } from "../[taskId]/tags/route";
import { DELETE as detachTagRoute } from "../[taskId]/tags/[tagId]/route";
import { POST as commentRoute } from "../[taskId]/comments/route";

const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";
const TAG = "22222222-2222-4222-8222-222222222222";

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/crm/tasks/t1", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}
const task = { params: Promise.resolve({ taskId: "t1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCrmTaskAccess).mockResolvedValue({ task: { id: "t1" }, orgId: "org_1" } as never);
  vi.mocked(requireCrmHouseholdAccess).mockResolvedValue({ household: { id: HOUSEHOLD }, orgId: "org_1" } as never);
});

describe("a task the caller may not see", () => {
  beforeEach(() => {
    vi.mocked(requireCrmTaskAccess).mockRejectedValue(new Error("CRM task not found or access denied: t1"));
  });

  const writes: { name: string; run: () => Promise<Response>; mutation: keyof typeof mutations }[] = [
    { name: "edit a field", run: () => patchRoute(req("PATCH", { field: "title", value: "x" }), task), mutation: "updateTaskField" },
    { name: "delete", run: () => deleteRoute(req("DELETE"), task), mutation: "deleteTask" },
    { name: "change status", run: () => statusRoute(req("POST", { status: "done" }), task), mutation: "setTaskStatus" },
    { name: "attach a tag", run: () => attachTagRoute(req("POST", { tagId: TAG }), task), mutation: "attachTag" },
    {
      name: "detach a tag",
      run: () => detachTagRoute(req("DELETE"), { params: Promise.resolve({ taskId: "t1", tagId: TAG }) }),
      mutation: "detachTag",
    },
    { name: "comment", run: () => commentRoute(req("POST", { bodyMarkdown: "hi" }), task), mutation: "postComment" },
  ];

  it.each(writes)("refuses to $name with 404 and writes nothing", async ({ run, mutation }) => {
    const res = await run();
    expect(res.status).toBe(404);
    expect(requireCrmTaskAccess).toHaveBeenCalledWith("t1");
    expect(mutations[mutation]).not.toHaveBeenCalled();
  });
});

describe("a household the caller may not see", () => {
  beforeEach(() => {
    vi.mocked(requireCrmHouseholdAccess).mockRejectedValue(
      new Error(`CRM household not found or access denied: ${HOUSEHOLD}`),
    );
  });

  it("refuses to create a task on it", async () => {
    const res = await createRoute(req("POST", { title: "Call", householdId: HOUSEHOLD }));
    expect(res.status).toBe(404);
    expect(requireCrmHouseholdAccess).toHaveBeenCalledWith(HOUSEHOLD);
    expect(mutations.createTask).not.toHaveBeenCalled();
  });

  it("refuses to move a task onto it", async () => {
    const res = await patchRoute(req("PATCH", { field: "householdId", value: HOUSEHOLD }), task);
    expect(res.status).toBe(404);
    expect(requireCrmHouseholdAccess).toHaveBeenCalledWith(HOUSEHOLD);
    expect(mutations.updateTaskField).not.toHaveBeenCalled();
  });

  it("still creates a task with no household", async () => {
    const res = await createRoute(req("POST", { title: "Call" }));
    expect(res.status).toBe(201);
    expect(requireCrmHouseholdAccess).not.toHaveBeenCalled();
  });

  it("still detaches a task from any household", async () => {
    const res = await patchRoute(req("PATCH", { field: "householdId", value: null }), task);
    expect(res.status).toBe(200);
    expect(requireCrmHouseholdAccess).not.toHaveBeenCalled();
  });
});
