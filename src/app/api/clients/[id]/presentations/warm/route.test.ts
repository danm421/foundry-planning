import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAfter = vi.fn((fn: () => Promise<void>) => { void fn(); });
const mockWarm = vi.fn(async (..._args: unknown[]) => {});
const mockRequireClientEditAccess = vi.fn(async (..._args: unknown[]) => ({ client: { crmHouseholdId: "h1" }, firmId: "f1", access: {} }));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (fn: () => Promise<void>) => mockAfter(fn) };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: async () => "org1" }));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  authErrorResponse: () => null,
}));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: (...a: unknown[]) => mockRequireClientEditAccess(...a) }));
vi.mock("@/lib/compute-cache/warm-comparison", () => ({ warmComparisonCompute: (...a: unknown[]) => mockWarm(...a) }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://x/api/clients/c1/presentations/warm", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}
const params = Promise.resolve({ id: "c1" });

beforeEach(() => vi.clearAllMocks());

describe("POST presentations/warm", () => {
  it("returns 202 and warms base + scenario in after()", async () => {
    const res = await POST(req({ scenarioId: "scn1", targetPoS: 0.9 }), { params });
    expect(res.status).toBe(202);
    expect(mockAfter).toHaveBeenCalledOnce();
    expect(mockWarm).toHaveBeenCalledWith({ clientId: "c1", firmId: "f1", scenarioId: "scn1", targetPoS: 0.9 });
  });

  it("rejects an invalid body with 400 and does not warm", async () => {
    const res = await POST(req({ scenarioId: "", targetPoS: 5 }), { params });
    expect(res.status).toBe(400);
    expect(mockWarm).not.toHaveBeenCalled();
  });
});
