import { describe, it, expect, vi, beforeEach } from "vitest";

const getTaskById = vi.fn();
vi.mock("@/lib/crm-tasks/queries", () => ({
  getTaskById: (t: string, f: string) => getTaskById(t, f),
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
  });

  it("rejects a same-firm task that belongs to ANOTHER household (cross-household IDOR)", async () => {
    getTaskById.mockResolvedValue({ task: { id: "t9", householdId: "hh-OTHER" }, tags: [] });
    const r = await __testing.assertTaskInHousehold("t9", "org_A", "hh-1");
    expect(r).toMatch(/does not belong to this client/i);
  });

  it("rejects a task id that is not in the firm at all", async () => {
    getTaskById.mockResolvedValue(null);
    expect(await __testing.assertTaskInHousehold("tX", "org_A", "hh-1")).toMatch(/not found/i);
  });
});
