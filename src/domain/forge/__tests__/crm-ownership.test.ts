import { describe, it, expect, vi, beforeEach } from "vitest";

const getTaskById = vi.fn();
vi.mock("@/lib/crm-tasks/queries", () => ({
  // Like the real read, a household-scoped lookup misses another household's task.
  getTaskById: async (t: string, f: string, access: { householdId?: string }) => {
    const row = await getTaskById(t, f, access);
    return row && access.householdId && row.task.householdId !== access.householdId ? null : row;
  },
  listTasks: vi.fn(),
  listTaskComments: vi.fn(),
  listTaskActivity: vi.fn(),
}));

import { __testing } from "../tools/crm";

beforeEach(() => getTaskById.mockReset());

describe("assertTaskInHousehold (IDOR guard)", () => {
  it("passes when the firm-scoped task belongs to the resolved household", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t1", householdId: "hh-1" }, tags: [] });
    expect(await __testing.assertTaskInHousehold("t1", "org_A", "hh-1")).toBe(true);
    expect(getTaskById).toHaveBeenCalledWith("t1", "org_A", { householdId: "hh-1" });
  });

  it("rejects a same-firm task that belongs to ANOTHER household (cross-household IDOR)", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t9", householdId: "hh-OTHER" }, tags: [] });
    const r = await __testing.assertTaskInHousehold("t9", "org_A", "hh-1");
    expect(getTaskById).toHaveBeenCalledWith("t9", "org_A", { householdId: "hh-1" });
    expect(r).toMatch(/not found for this client/i);
  });

  it("rejects a task id that is not in the firm at all", async () => {
    getTaskById.mockResolvedValue(null);
    expect(await __testing.assertTaskInHousehold("tX", "org_A", "hh-1")).toMatch(/not found/i);
  });
});
