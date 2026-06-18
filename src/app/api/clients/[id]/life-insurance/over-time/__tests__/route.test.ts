import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
  ),
}));
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn() }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));
vi.mock("@/lib/life-insurance/load-li-portfolio", () => ({
  loadLiProceedsGrowth: vi.fn(),
  DEFAULT_LI_GROWTH: 0.05,
}));
vi.mock("@/lib/life-insurance/need-over-time", () => ({
  computeNeedOverTime: vi.fn(() => []),
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
  // verifyClientAccess is now 1-arg. Source the firm from the test's FIRM_ID
  // (inlined — vi.mock is hoisted above the const) and return the object shape;
  // tests that set findClientInFirm → null still drive the 404 path.
  verifyClientAccess: vi.fn().mockImplementation(async (clientId: string) => {
    const { findClientInFirm } = await import("@/lib/db-scoping");
    const client = await findClientInFirm(clientId, "00000000-0000-4000-8000-000000000099");
    return client != null
      ? { ok: true, permission: "edit", firmId: "00000000-0000-4000-8000-000000000099", access: "own" }
      : { ok: false };
  }),
}));

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { checkProjectionRateLimit } from "@/lib/rate-limit";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadLiProceedsGrowth } from "@/lib/life-insurance/load-li-portfolio";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

const VALID_BODY = {
  deathYear: 2030,
  modelPortfolioId: null,
  leaveToHeirsAmount: 1000000,
  livingExpenseAtDeath: 80000,
  payoffLiabilityIds: [],
  mcTargetScore: 0.8,
};

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/life-insurance/over-time`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  ) as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue(FIRM_ID);
  vi.mocked(findClientInFirm).mockResolvedValue({ id: CLIENT_ID } as never);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { client: { filingStatus: "single" } },
    warnings: [],
  } as never);
  vi.mocked(loadLiProceedsGrowth).mockResolvedValue({
    rate: 0.05,
    realization: {},
    mix: [],
  } as never);
});

describe("POST /api/clients/[id]/life-insurance/over-time — rate limit (F6)", () => {
  it("returns the rate-limit denial and never touches the client when over budget", async () => {
    vi.mocked(checkProjectionRateLimit).mockResolvedValue({
      allowed: false,
    } as never);
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(429);
    // The guard must gate BEFORE the work — no client lookup, no tree load.
    expect(findClientInFirm).not.toHaveBeenCalled();
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });

  it("consults the projection rate limit with the firm id and proceeds when allowed", async () => {
    vi.mocked(checkProjectionRateLimit).mockResolvedValue({
      allowed: true,
    } as never);
    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(checkProjectionRateLimit).toHaveBeenCalledWith(FIRM_ID);
    expect(res.status).toBe(200);
  });
});
