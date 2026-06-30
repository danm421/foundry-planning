import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return {
    ...actual,
    requireOrgId: vi.fn(),
  };
});
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(() => new Response("rl", { status: 429 })),
}));
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(),
}));
vi.mock("@/lib/compute-cache/solver-mc", () => ({
  getOrComputeSolverMc: vi.fn(),
  getOrComputeSolverMcReport: vi.fn(),
}));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
}));
// Phase 1b: verifyClientAccess now owns the client-in-firm gate (replaces
// findClientInFirm). Delegate to the already-mocked findClientInFirm so tests
// that set findClientInFirm → null still exercise the 404 path.
vi.mock("@/lib/clients/authz", () => ({
  // verifyClientAccess is now 1-arg. Source the firm from the test's firm
  // ("firm-1", inlined — vi.mock is hoisted) and return the object shape; tests
  // that set findClientInFirm → null still drive the 404 path.
  verifyClientAccess: vi.fn().mockImplementation(async (clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    const client = await findClientInFirm(clientId, "firm-1");
    return client != null
      ? { ok: true, permission: "edit", firmId: "firm-1", access: "own" }
      : { ok: false };
  }),
}));

import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { checkProjectionRateLimit } from "@/lib/rate-limit";
import { getOrComputeSolverMc, getOrComputeSolverMcReport } from "@/lib/compute-cache/solver-mc";
import { POST } from "../route";

function makeRequest(body: unknown) {
  return new Request("http://test/api/clients/c1/solver/monte-carlo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}
const ctx = { params: Promise.resolve({ id: "c1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("firm-1");
  vi.mocked(checkProjectionRateLimit).mockResolvedValue({ allowed: true, remaining: 29, reset: 0 });
  vi.mocked(findClientInFirm).mockResolvedValue({ id: "c1" } as never);
  vi.mocked(getOrComputeSolverMc).mockResolvedValue({ successRate: 0.88 });
  vi.mocked(getOrComputeSolverMcReport).mockResolvedValue({
    payload: { summary: {} }, raw: { successRate: 0.73 }, meta: {},
  } as never);
});

describe("POST /api/clients/[id]/solver/monte-carlo", () => {
  it("returns 400 on invalid body", async () => {
    const res = await POST(makeRequest({ bogus: true }), ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the client is not in the firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValue(null as never);
    const res = await POST(makeRequest({ source: "base", mutations: [] }), ctx);
    expect(res.status).toBe(404);
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    vi.mocked(checkProjectionRateLimit).mockResolvedValueOnce({ allowed: false } as never);
    const res = await POST(makeRequest({ source: "base", mutations: [] }), ctx);
    expect(res.status).toBe(429);
  });

  it("returns the successRate from the helper", async () => {
    const res = await POST(makeRequest({ source: "base", mutations: [] }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ successRate: 0.88 });
    expect(getOrComputeSolverMc).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "firm-1",
      source: "base",
      mutations: [],
    });
  });

  it("forwards extraAccountMixes to getOrComputeSolverMc", async () => {
    const mixes = [{ accountId: "acct-min", mix: [{ assetClassId: "ac-1", weight: 0.6 }] }];
    const req = makeRequest({ source: "base", mutations: [], extraAccountMixes: mixes });
    await POST(req, ctx);
    expect(vi.mocked(getOrComputeSolverMc)).toHaveBeenCalledWith(
      expect.objectContaining({ extraAccountMixes: mixes }),
    );
  });

  it("full:true returns the full CachedMonteCarloResult", async () => {
    const res = await POST(makeRequest({ source: "base", mutations: [], full: true }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.raw.successRate).toBe(0.73);
    expect(body.payload).toBeDefined();
    expect(getOrComputeSolverMcReport).toHaveBeenCalledOnce();
    expect(getOrComputeSolverMc).not.toHaveBeenCalled();
  });
});
