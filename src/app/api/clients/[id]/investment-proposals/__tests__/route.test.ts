import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(async () => "org_1"),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(async () => ({ ok: true, firmId: "firm_1", access: "own" })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/clients/cross-firm-audit", () => ({ crossFirmAuditMeta: () => ({}) }));
vi.mock("@/lib/investments/proposals/compute", () => ({
  computeProposalSnapshot: vi.fn(async () => ({ version: 1, computedAt: "2026-08-12T00:00:00.000Z" })),
}));

const insertReturning = vi.fn(async () => [{ id: "p1" }]);
vi.mock("@/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
  },
}));

const listProposals = vi.fn(async () => []);
vi.mock("@/lib/investments/proposals/queries", () => ({
  listProposals: (...a: unknown[]) => listProposals(...(a as [])),
  getProposal: vi.fn(async () => null),
  loadExpenseRatios: vi.fn(async () => new Map()),
}));

import { GET, POST } from "../route";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";

const params = Promise.resolve({ id: "client_1" });
const req = (body: unknown) =>
  new Request("http://t/api", { method: "POST", body: JSON.stringify(body) }) as never;

// Zod 4's `.uuid()` is RFC 9562-strict: the 13th nibble is the version and the
// 17th the variant, so an all-1s string is NOT a valid uuid. Same fixture shape
// the rebalance/compute route test uses.
const validBody = {
  name: "Move to Core Moderate",
  source: { accountIds: ["11111111-1111-4111-8111-111111111111"] },
  target: { portfolioId: "22222222-2222-4222-8222-222222222222" },
  targetLabel: "Core Moderate",
};

beforeEach(() => vi.clearAllMocks());

describe("POST /investment-proposals", () => {
  it("creates a proposal and returns its id", async () => {
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "p1" });
  });

  it("audits the creation", async () => {
    await POST(req(validBody), { params });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "investment_proposal.create",
        clientId: "client_1",
        firmId: "firm_1",
      }),
    );
  });

  it("rejects a body that fails the schema", async () => {
    const res = await POST(req({ ...validBody, name: "" }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("issues");
  });

  it("returns 404 when the caller cannot reach the client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(404);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("GET /investment-proposals", () => {
  it("scopes the list to the requested client", async () => {
    await GET(new Request("http://t/api") as never, { params });
    expect(listProposals).toHaveBeenCalledWith("client_1");
  });

  it("returns 404 when the caller cannot reach the client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await GET(new Request("http://t/api") as never, { params });
    expect(res.status).toBe(404);
  });
});
