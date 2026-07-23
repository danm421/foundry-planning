import { describe, it, expect, vi } from "vitest";

// navigate-global imports custom-events which imports server-only (not resolvable
// from the worktree's near-empty node_modules). Mock it so assembly stays pure.
vi.mock("../../custom-events", () => ({ emitNavigate: vi.fn(), emitPageLink: vi.fn(), emitWalkthrough: vi.fn() }));
// global-actions imports @/lib/crm/households which transitively imports server-only
// via audit/snapshots/household. Mock it so the assembly test stays pure.
vi.mock("@/lib/crm/households", () => ({ listCrmHouseholds: vi.fn(), getCrmHousehold: vi.fn(), createCrmHousehold: vi.fn() }));
// global-actions (set_up_plan) imports create-client which imports @/db.
vi.mock("@/lib/clients/create-client", () => ({ createClientForHousehold: vi.fn() }));
// global-tasks imports crm-tasks/mutations which imports @/db.
vi.mock("@/lib/crm-tasks/mutations", () => ({ createTask: vi.fn(), updateTaskField: vi.fn(), setTaskStatus: vi.fn(), postComment: vi.fn(), deleteTask: vi.fn() }));
// global-tasks imports crm-tasks/queries (@/db) and members (server-only + Clerk).
vi.mock("@/lib/crm-tasks/queries", () => ({
  listTasks: vi.fn(), getTaskById: vi.fn(), listTaskComments: vi.fn(),
  listTaskActivity: vi.fn(), listTaskFiles: vi.fn(),
}));
vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: vi.fn() }));
// global-actions (build_plan) imports the shared plan-import core.
vi.mock("@/lib/imports/plan-builder-core", () => ({ ensurePlanImport: vi.fn() }));

import { buildGlobalTools } from "../global-index";

const toolCtx = { ctx: { userId: "u1", firmId: "f1" }, conversationId: "c1" };

describe("buildGlobalTools", () => {
  it("contains ONLY help + global-navigate + global-action + walkthrough + global-task tools", () => {
    const names = buildGlobalTools(toolCtx).map((t) => t.name).sort();
    expect(names).toEqual([
      "build_plan", "cite_page", "create_household", "find_client", "firm_members", "get_help",
      "ingest_fact_finder", "open_client", "open_page", "search_help", "set_up_plan", "start_walkthrough",
      "tasks_comment", "tasks_create", "tasks_delete", "tasks_detail", "tasks_list",
      "tasks_set_status", "tasks_update",
    ]);
  });

  it("contains NO client-scoped tool", () => {
    const names = new Set(buildGlobalTools(toolCtx).map((t) => t.name));
    for (const clientTool of ["run_projection", "add_expense", "crm_add_note", "propose_changes"]) {
      expect(names.has(clientTool)).toBe(false);
    }
  });
});
