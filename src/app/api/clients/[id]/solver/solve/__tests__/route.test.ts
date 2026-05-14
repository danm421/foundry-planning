import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(),
}));
vi.mock("@/lib/db-scoping", () => ({
  findClientInFirm: vi.fn(),
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(),
}));
vi.mock("@/lib/projection/load-monte-carlo-data", () => ({
  loadMonteCarloData: vi.fn(),
}));
vi.mock("@/lib/solver/solve-target", () => ({
  solveTarget: vi.fn(),
}));

import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { solveTarget } from "@/lib/solver/solve-target";
import { POST } from "../route";

async function readBody(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  let out = "";
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

function makeRequest(body: unknown): Request {
  return new Request("http://test/api/clients/c1/solver/solve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("firm-1");
  vi.mocked(findClientInFirm).mockResolvedValue(true);
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { client: {}, accounts: [], incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [], planSettings: {} } as never,
  });
  vi.mocked(loadMonteCarloData).mockResolvedValue({
    indices: [], correlation: [], accountMixes: [], startingLiquidBalance: 0, seed: 1, requiredMinimumAssetLevel: 0,
  });
});

describe("POST /api/clients/[id]/solver/solve", () => {
  it("returns 400 on invalid body", async () => {
    const res = await POST(makeRequest({ bogus: true }), ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when client not in firm", async () => {
    vi.mocked(findClientInFirm).mockResolvedValueOnce(false);
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [],
        target: { kind: "retirement-age", person: "client" },
        targetPoS: 0.85,
      }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it("streams progress events followed by a result event", async () => {
    vi.mocked(solveTarget).mockImplementation(async (args) => {
      args.onProgress?.({ iteration: 1, candidateValue: 50, achievedPoS: 0.7 });
      args.onProgress?.({ iteration: 2, candidateValue: 80, achievedPoS: 0.95 });
      args.onProgress?.({ iteration: 3, candidateValue: 65, achievedPoS: 0.85 });
      return {
        status: "converged",
        solvedValue: 65,
        achievedPoS: 0.85,
        iterations: 3,
        finalProjection: [{ year: 2026 } as never],
      };
    });

    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [],
        target: { kind: "retirement-age", person: "client" },
        targetPoS: 0.85,
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await readBody(res);
    expect(body).toContain("event: progress");
    expect(body).toContain('"iteration":1');
    expect(body).toContain("event: result");
    expect(body).toContain('"status":"converged"');
    expect(body).toContain('"solvedValue":65');
  });

  it("emits an error event when solveTarget throws", async () => {
    vi.mocked(solveTarget).mockRejectedValueOnce(new Error("engine boom"));
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [],
        target: { kind: "retirement-age", person: "client" },
        targetPoS: 0.85,
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body).toContain("event: error");
    expect(body).toContain("engine boom");
  });

  it("clamps invalid targetPoS via Zod validation", async () => {
    const res = await POST(
      makeRequest({
        source: "base",
        mutations: [],
        target: { kind: "retirement-age", person: "client" },
        targetPoS: 1.5,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });
});
