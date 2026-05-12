import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(async () => "firm1"),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: "client1", firstName: "Ada", lastName: "Lovelace" }]),
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

vi.mock("@/lib/scenario/load-projection-for-ref", () => ({
  loadProjectionForRef: vi.fn(async () => ({
    tree: { client: { firstName: "Ada", lastName: "Lovelace" } },
    result: {
      years: [
        {
          year: 2030,
          ages: { client: 65 },
          income: { total: 100000 },
          expenses: { total: 80000 },
          taxResult: { flow: { totalTax: 12000 } },
          portfolioAssets: { total: 1_000_000 },
        },
      ],
    },
    scenarioName: "Baseline",
    isDoNothing: false,
  })),
}));

const azureMock = vi.fn(async () => "Generated commentary.");
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
  const req = new Request("http://localhost/api/clients/client1/comparison/ai-analysis", {
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

const validBody = {
  resolvedSources: [
    {
      cellId: "c1",
      groupId: "g1",
      groupTitle: "Retirement",
      widgetKind: "kpi",
      planIds: ["base"],
      yearRange: { start: 2030, end: 2032 },
    },
  ],
  tone: "concise",
  length: "short",
  customInstructions: "",
  force: false,
};

describe("POST /api/clients/[id]/comparison/ai-analysis", () => {
  it("rejects a body that fails validation (400)", async () => {
    const res = await post({ resolvedSources: [], tone: "wrong", length: "short", customInstructions: "", force: false });
    expect(res.status).toBe(400);
  });

  it("returns cached: false and calls Azure on a cache miss", async () => {
    getMock.mockResolvedValueOnce(null);
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(false);
    expect(json.markdown).toBe("Generated commentary.");
    expect(azureMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
  });

  it("returns cached: true and does not call Azure on a cache hit", async () => {
    getMock.mockResolvedValueOnce({ markdown: "Cached body.", generatedAt: "2026-05-12T00:00:00Z" });
    const res = await post(validBody);
    const json = await res.json();
    expect(json.cached).toBe(true);
    expect(json.markdown).toBe("Cached body.");
    expect(azureMock).not.toHaveBeenCalled();
  });

  it("bypasses the cache when force is true and overwrites the entry", async () => {
    getMock.mockResolvedValueOnce({ markdown: "stale", generatedAt: "old" });
    const res = await post({ ...validBody, force: true });
    const json = await res.json();
    expect(json.cached).toBe(false);
    expect(azureMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});
