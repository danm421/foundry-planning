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
vi.mock("@/lib/solver/apply-mutations", () => ({
  applyMutations: vi.fn((tree) => tree),
}));
vi.mock("@/lib/solver/resolve-technique-mutations", () => ({
  resolveTechniqueMutations: vi.fn((tree) => tree),
}));
vi.mock("@/lib/life-insurance/load-li-portfolio", () => ({
  loadLiProceedsGrowth: vi.fn(),
  DEFAULT_LI_GROWTH: 0.05,
}));
vi.mock("@/lib/life-insurance/need-over-time", () => ({
  // Async, matching the real signature — the route must await it, or the
  // terminal `result` event would carry a serialized Promise instead of rows.
  computeNeedOverTime: vi.fn(async () => []),
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
import { applyMutations } from "@/lib/solver/apply-mutations";
import { computeNeedOverTime } from "@/lib/life-insurance/need-over-time";
import { loadLiProceedsGrowth } from "@/lib/life-insurance/load-li-portfolio";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";
const SCENARIO_ID = "00000000-0000-4000-8000-0000000000aa";

const ASSUMPTIONS = {
  deathYear: 2030,
  modelPortfolioId: null,
  leaveToHeirsAmount: 1000000,
  livingExpenseAtDeath: 80000,
  payoffLiabilityIds: [],
  mcTargetScore: 0.8,
};

// Live-solver envelope: source (base | scenario id) + unsaved mutations wrap the
// assumptions, so the need curve reflects the edited plan, not the base case.
const VALID_BODY = {
  source: "base",
  mutations: [],
  assumptions: ASSUMPTIONS,
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
    effectiveTree: {
      client: { filingStatus: "single" },
      planSettings: { planStartYear: 2026, planEndYear: 2027 },
    },
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

/** Drain the SSE stream so the ReadableStream `start` body (which does the tree
 *  load + solve) runs to completion before assertions. */
async function drain(res: Response): Promise<void> {
  const reader = res.body!.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("POST /api/clients/[id]/life-insurance/over-time — honors edited scenario", () => {
  beforeEach(() => {
    vi.mocked(checkProjectionRateLimit).mockResolvedValue({ allowed: true } as never);
  });

  it("solves the source scenario + mutations, not the hardcoded base case", async () => {
    const res = await POST(
      makeRequest({ source: SCENARIO_ID, mutations: [], assumptions: ASSUMPTIONS }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    await drain(res);

    // The edited plan's scenario id drives the tree load — NOT "base".
    expect(loadEffectiveTree).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, SCENARIO_ID, {});
    // Live mutations are applied to the loaded tree before solving.
    expect(applyMutations).toHaveBeenCalled();
    // The need curve is computed against the mutated working tree.
    expect(computeNeedOverTime).toHaveBeenCalled();
  });

  it("defaults source to base when omitted (back-compat)", async () => {
    const res = await POST(
      makeRequest({ assumptions: ASSUMPTIONS }),
      ctx as never,
    );
    expect(res.status).toBe(200);
    await drain(res);
    expect(loadEffectiveTree).toHaveBeenCalledWith(CLIENT_ID, FIRM_ID, "base", {});
  });
});

describe("POST /api/clients/[id]/life-insurance/over-time — SSE event shape", () => {
  beforeEach(() => {
    vi.mocked(checkProjectionRateLimit).mockResolvedValue({ allowed: true } as never);
  });

  it("emits a meta event, a row per progress event, then a terminal result", async () => {
    vi.mocked(computeNeedOverTime).mockImplementation(
      async (_tree, _a, _cover, onProgress) => {
        const rows = [
          { year: 2026, clientNeed: 100, spouseNeed: 50, clientStatus: "solved", spouseStatus: "solved" },
          { year: 2027, clientNeed: 120, spouseNeed: 60, clientStatus: "solved", spouseStatus: "solved" },
        ] as never[];
        rows.forEach((r, i) => onProgress?.(i + 1, rows.length, r as never));
        return rows as never;
      },
    );

    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain("event: meta");
    expect(text).toContain('"planStartYear"');
    expect(text).toContain("event: progress");
    expect(text).toMatch(/"row":\s*\{/);
    expect(text).toContain("event: result");

    // The result payload carries the actual rows — a route that forgets to
    // await the (async) compute would serialize a Promise to `{}` here.
    const resultChunk = text
      .split("\n\n")
      .find((chunk) => chunk.startsWith("event: result"));
    expect(resultChunk).toBeDefined();
    const resultPayload = JSON.parse(resultChunk!.split("\ndata: ")[1]);
    expect(resultPayload.rows).toHaveLength(2);
    expect(resultPayload.rows[0].year).toBe(2026);

    // Order: meta before any progress, all progress before the terminal result.
    const metaIdx = text.indexOf("event: meta");
    const firstProgressIdx = text.indexOf("event: progress");
    const resultIdx = text.indexOf("event: result");
    expect(metaIdx).toBeGreaterThanOrEqual(0);
    expect(metaIdx).toBeLessThan(firstProgressIdx);
    expect(firstProgressIdx).toBeLessThan(resultIdx);
  });
});

describe("POST /api/clients/[id]/life-insurance/over-time — meta tracks the mutated working tree", () => {
  beforeEach(() => {
    vi.mocked(checkProjectionRateLimit).mockResolvedValue({ allowed: true } as never);
  });

  it("emits meta from the WORKING tree's plan range, not the effective tree's", async () => {
    // The top-level beforeEach's loadEffectiveTree mock has planEndYear 2027 and
    // no resolutionContext, so resolveTechniqueMutations never runs — only
    // applyMutations's return value determines the working tree here. Make it
    // diverge from the effective tree (2030 vs 2027) so this test can tell
    // whether `meta` is sourced from the working tree (correct) or the
    // effective tree (regression).
    vi.mocked(applyMutations).mockReturnValue({
      client: { filingStatus: "single" },
      planSettings: { planStartYear: 2026, planEndYear: 2030 },
    } as never);

    const res = await POST(makeRequest(VALID_BODY), ctx as never);
    expect(res.status).toBe(200);
    const text = await res.text();

    const metaChunk = text.split("\n\n").find((chunk) => chunk.startsWith("event: meta"));
    expect(metaChunk).toBeDefined();
    const metaPayload = JSON.parse(metaChunk!.split("\ndata: ")[1]);

    // Working tree's horizon (2030) — not the effective tree's (2027).
    expect(metaPayload.planEndYear).toBe(2030);
    expect(metaPayload.planEndYear).not.toBe(2027);
  });
});
