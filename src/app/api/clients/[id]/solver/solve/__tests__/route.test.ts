import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(),
}));
// The route gained a projection rate-limit guard (audit F11); let it pass so
// tests don't hit the real shared Upstash budget (nondeterministic once spent).
vi.mock("@/lib/rate-limit", () => ({
  checkProjectionRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
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

function makeRequest(body: unknown) {
  return new Request("http://test/api/clients/c1/solver/solve", {
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
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: { client: {}, accounts: [], incomes: [], expenses: [], liabilities: [], savingsRules: [], withdrawalStrategy: [], planSettings: {}, reinvestments: [] } as never,
    warnings: [],
  } as never);
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
    vi.mocked(findClientInFirm).mockResolvedValueOnce(null as never);
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
        objective: "pos",
        status: "converged",
        solvedValue: 65,
        achievedPoS: 0.85,
        canonicalPoS: 0.85,
        iterations: 3,
        finalProjection: [{ year: 2026 } as never],
        seed: 1,
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
    // Audit F4: the SSE error event is sanitized — the client gets a generic
    // message, never the raw engine error string (which can embed internal IDs).
    expect(body).toContain("Internal server error");
    expect(body).not.toContain("engine boom");
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

  it("threads extraAccountMixes into loadMonteCarloData", async () => {
    vi.mocked(solveTarget).mockResolvedValueOnce({
      status: "converged",
      solvedValue: 100,
      achievedPoS: 0.85,
      iterations: 1,
      finalProjection: [],
    } as never);
    const body = {
      source: "base",
      mutations: [],
      target: { kind: "savings-contribution", accountId: "11111111-1111-1111-1111-111111111111" },
      targetPoS: 0.85,
      extraAccountMixes: [
        { accountId: "11111111-1111-1111-1111-111111111111", mix: [{ assetClassId: "ac-1", weight: 0.6 }] },
      ],
    };
    await POST(makeRequest(body), ctx);
    // 4th positional arg of loadMonteCarloData is extraAccountMixes
    expect(vi.mocked(loadMonteCarloData).mock.calls[0][3]).toEqual(body.extraAccountMixes);
  });

  it("passes a reinvestment-aware effective tree to loadMonteCarloData (I1)", async () => {
    // A model-portfolio reinvestment in the baseline mutations must reach the MC
    // loader (5th positional arg) so "solve to target" reflects the allocation
    // switch — matching the deterministic search tree and the Techniques gauge.
    // Without the fix, the route passed no effectiveTree and MC stayed base-mix.
    vi.mocked(loadEffectiveTree).mockResolvedValueOnce({
      effectiveTree: {
        client: {},
        accounts: [{ id: "acct-1", value: 100000, category: "taxable", owners: [] }],
        incomes: [], expenses: [], liabilities: [], savingsRules: [],
        withdrawalStrategy: [], planSettings: {}, reinvestments: [],
      } as never,
      warnings: [],
    } as never);
    vi.mocked(solveTarget).mockResolvedValueOnce({
      status: "converged", solvedValue: 65, achievedPoS: 0.85, iterations: 1, finalProjection: [],
    } as never);

    const reinvestment = {
      id: "ri-1",
      name: "Shift to conservative",
      accountIds: ["acct-1"],
      year: 2035,
      newGrowthRate: 0.05,
      realizeTaxesOnSwitch: false,
      soldFractionByAccount: {},
      targetType: "model_portfolio",
      modelPortfolioId: "mp-1",
    };

    await POST(
      makeRequest({
        source: "base",
        mutations: [{ kind: "reinvestment-upsert", id: "ri-1", value: reinvestment }],
        target: { kind: "retirement-age", person: "client" },
        targetPoS: 0.85,
      }),
      ctx,
    );

    // 5th positional arg is the effectiveTree; it must carry the reinvestment so
    // buildAccountMixSegments emits a switch segment at ri.year (not base-only).
    const treeArg = vi.mocked(loadMonteCarloData).mock.calls[0][4];
    expect(treeArg?.reinvestments).toEqual([
      expect.objectContaining({ id: "ri-1", year: 2035, modelPortfolioId: "mp-1" }),
    ]);
  });
});
