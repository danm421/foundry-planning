import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
vi.mock("@/db", () => ({ db: { update: () => ({ set: updateSet }) } }));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "firm-1", access: "own" }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));

import { PATCH } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/clients/c1/view-mode", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as never;
}
const params = Promise.resolve({ id: "c1" });

describe("PATCH /api/clients/[id]/view-mode", () => {
  beforeEach(() => updateSet.mockClear());

  it("accepts map", async () => {
    const res = await PATCH(req({ mode: "map" }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, mode: "map" });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ detailsViewMode: "map" }),
    );
  });

  it("accepts detailed", async () => {
    const res = await PATCH(req({ mode: "detailed" }), { params });
    expect(res.status).toBe(200);
  });

  it("rejects an unknown mode without writing", async () => {
    const res = await PATCH(req({ mode: "blueprint" }), { params });
    expect(res.status).toBe(400);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects a missing mode", async () => {
    const res = await PATCH(req({}), { params });
    expect(res.status).toBe(400);
  });
});
