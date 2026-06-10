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
}));

import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { getOrComputeSolverMc } from "@/lib/compute-cache/solver-mc";
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
  vi.mocked(findClientInFirm).mockResolvedValue({ id: "c1" } as never);
  vi.mocked(getOrComputeSolverMc).mockResolvedValue({ successRate: 0.88 });
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
});
