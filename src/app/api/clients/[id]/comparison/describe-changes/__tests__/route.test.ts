import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(async () => "firm1"),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: "client1" }]),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({ clients: {} }));
vi.mock("drizzle-orm", () => ({ and: (...x: unknown[]) => x, eq: (...x: unknown[]) => x }));
vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));
vi.mock("@/lib/rate-limit", () => ({
  checkExtractRateLimit: vi.fn(async () => ({ allowed: true, remaining: 4, reset: Date.now() + 60000 })),
  rateLimitErrorResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));

const azureMock = vi.fn(async () => "Generated description.");
vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: azureMock }));

const getMock = vi.fn();
const setMock = vi.fn(async () => undefined);
vi.mock("@/lib/comparison/ai-cache", async () => {
  const actual = await vi.importActual<typeof import("@/lib/comparison/ai-cache")>("@/lib/comparison/ai-cache");
  return {
    ...actual,
    getCachedAnalysis: getMock,
    setCachedAnalysis: setMock,
  };
});

async function post(body: unknown) {
  const { POST } = await import("../route");
  const req = new Request("http://localhost/api/clients/client1/comparison/describe-changes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: "client1" }) });
}

beforeEach(() => {
  azureMock.mockClear();
  getMock.mockReset();
  setMock.mockReset();
});

const validUnit = {
  kind: "single",
  change: {
    id: "c1",
    scenarioId: "11111111-1111-4111-a111-111111111111",
    opType: "edit",
    targetKind: "income",
    targetId: "i1",
    payload: { endYear: { from: 2040, to: 2042 } },
    toggleGroupId: null,
    orderIndex: 0,
    enabled: true,
  },
} as const;

// Use a valid RFC 4122 UUID (variant bits: 8-b in 9th hex char of 4th group)
const validBody = {
  scenarioId: "11111111-1111-4111-a111-111111111111",
  unit: validUnit,
  targetNames: { "income:i1": "Cooper's Salary" },
};

describe("POST /api/clients/[id]/comparison/describe-changes", () => {
  it("rejects invalid body (400)", async () => {
    const res = await post({ scenarioId: "not-a-uuid", unit: validUnit, targetNames: {} });
    expect(res.status).toBe(400);
  });

  it("returns cached markdown on cache hit", async () => {
    getMock.mockResolvedValueOnce({ markdown: "Cached description.", generatedAt: "2026-05-13T00:00:00Z" });
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.markdown).toBe("Cached description.");
    expect(json.cached).toBe(true);
    expect(azureMock).not.toHaveBeenCalled();
  });

  it("calls Azure on cache miss and writes the result", async () => {
    getMock.mockResolvedValueOnce(null);
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(false);
    expect(json.markdown).toBe("Generated description.");
    expect(azureMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const { NextResponse } = await import("next/server");
    const { checkExtractRateLimit, rateLimitErrorResponse } = await import("@/lib/rate-limit");
    vi.mocked(checkExtractRateLimit).mockResolvedValueOnce({ allowed: false, reason: "exceeded", remaining: 0, reset: Date.now() + 60000 });
    vi.mocked(rateLimitErrorResponse).mockReturnValueOnce(NextResponse.json({ error: "rate limited" }, { status: 429 }));
    const res = await post(validBody);
    expect(res.status).toBe(429);
  });
});
