import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOrgAdminOrOwner: vi.fn(),
  purgeCrmHousehold: vi.fn(),
}));

vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireOrgAdminOrOwner: mocks.requireOrgAdminOrOwner };
});
vi.mock("@/lib/crm/households", () => ({ purgeCrmHousehold: mocks.purgeCrmHousehold }));

import { DELETE } from "../route";
import { ForbiddenError } from "@/lib/authz";

const req = () => new Request("http://test", { method: "DELETE" }) as never;
const ctx = { params: Promise.resolve({ id: "h1" }) };

beforeEach(() => {
  mocks.requireOrgAdminOrOwner.mockReset();
  mocks.purgeCrmHousehold.mockReset();
});

describe("DELETE /api/crm/households/[id]/permanent", () => {
  it("returns 403 and does not purge for a non-admin", async () => {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(new ForbiddenError("nope"));
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(403);
    expect(mocks.purgeCrmHousehold).not.toHaveBeenCalled();
  });

  it("purges for an owner/admin", async () => {
    mocks.requireOrgAdminOrOwner.mockResolvedValue(undefined);
    mocks.purgeCrmHousehold.mockResolvedValue(undefined);
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    expect(mocks.purgeCrmHousehold).toHaveBeenCalledWith("h1");
  });
});
