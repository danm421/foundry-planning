import { describe, it, expect, vi } from "vitest";

// navigate-global imports custom-events which imports server-only (not resolvable
// from the worktree's near-empty node_modules). Mock it so assembly stays pure.
vi.mock("../../custom-events", () => ({ emitNavigate: vi.fn(), emitPageLink: vi.fn(), emitWalkthrough: vi.fn() }));
// global-actions imports @/lib/crm/households which transitively imports server-only
// via audit/snapshots/household. Mock it so the assembly test stays pure.
vi.mock("@/lib/crm/households", () => ({ listCrmHouseholds: vi.fn(), getCrmHousehold: vi.fn(), createCrmHousehold: vi.fn() }));
// global-actions (set_up_plan) imports create-client which imports @/db.
vi.mock("@/lib/clients/create-client", () => ({ createClientForHousehold: vi.fn() }));
// global-actions (create_task_for_client) imports crm-tasks/mutations which imports @/db.
vi.mock("@/lib/crm-tasks/mutations", () => ({ createTask: vi.fn(), updateTaskField: vi.fn(), setTaskStatus: vi.fn(), postComment: vi.fn(), deleteTask: vi.fn() }));

import { buildGlobalTools } from "../global-index";

const toolCtx = { ctx: { userId: "u1", firmId: "f1" }, conversationId: "c1" };

describe("buildGlobalTools", () => {
  it("contains ONLY help + global-navigate + global-action + walkthrough tools", () => {
    const names = buildGlobalTools(toolCtx).map((t) => t.name).sort();
    expect(names).toEqual(["cite_page", "create_household", "create_task_for_client", "find_client", "get_help", "open_client", "open_page", "search_help", "set_up_plan", "start_walkthrough"]);
  });

  it("contains NO client-scoped tool", () => {
    const names = new Set(buildGlobalTools(toolCtx).map((t) => t.name));
    for (const clientTool of ["run_projection", "add_expense", "crm_add_note", "propose_changes"]) {
      expect(names.has(clientTool)).toBe(false);
    }
  });
});
