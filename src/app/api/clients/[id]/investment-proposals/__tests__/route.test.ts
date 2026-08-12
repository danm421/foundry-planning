import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(async () => "org_1"),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(async () => ({
    ok: true,
    permission: "edit",
    firmId: "firm_1",
    access: "own",
  })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/clients/cross-firm-audit", () => ({ crossFirmAuditMeta: () => ({}) }));
vi.mock("@/lib/investments/proposals/compute", () => ({
  computeProposalSnapshot: vi.fn(async () => ({ version: 1, computedAt: "2026-08-12T00:00:00.000Z" })),
}));

const insertValues: Record<string, unknown>[] = [];
const insertReturning = vi.fn(async () => [{ id: "p1" }]);
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertValues.push(values);
        return { returning: insertReturning };
      },
    }),
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
import { computeProposalSnapshot } from "@/lib/investments/proposals/compute";
import { UnclassifiableTickerError } from "@/lib/investments/rebalance/resolve-target";

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

beforeEach(() => {
  vi.clearAllMocks();
  insertValues.length = 0;
});

describe("POST /investment-proposals", () => {
  it("creates a proposal and returns its id", async () => {
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "p1" });
  });

  it("writes the scoped ids, the real author, and decimal strings", async () => {
    await POST(
      req({ ...validBody, advisoryFeeCurrent: 0.009, advisoryFeeProposed: 0.0075 }),
      { params },
    );
    expect(insertValues[0]).toMatchObject({
      firmId: "firm_1",
      clientId: "client_1",
      // The Clerk user id, not the org — otherwise every proposal in a firm
      // would look like it had the same author.
      createdBy: "user_1",
      // Drizzle decimal columns take strings; a raw number silently rounds.
      advisoryFeeCurrent: "0.009",
      advisoryFeeProposed: "0.0075",
      // Omitted optional inputs settle to null, not undefined.
      overrideLtcgRate: null,
      notes: null,
    });
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
    expect(insertValues).toHaveLength(0);
  });

  it("rejects an ad-hoc target weight outside 0..1", async () => {
    // The builder sends decimal fractions, so a percent typed straight through
    // (60 rather than 0.6) must be refused, not computed as a 6000% weight.
    const res = await POST(
      req({ ...validBody, target: { holdings: [{ ticker: "VTI", weight: 60 }] } }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(insertValues).toHaveLength(0);
  });

  /** An outside-portfolio source, the shape the ad-hoc holding rules apply to. */
  const adHocBody = (holdings: unknown[]) => ({
    ...validBody,
    source: { adHoc: { taxable: true, holdings } },
  });

  it("rejects a negative market value on an ad-hoc holding", async () => {
    // A negative value makes `totalValue` — and every dollar figure in the frozen
    // snapshot — nonsense, with nothing to signal it.
    const res = await POST(req(adHocBody([{ ticker: "SPY", marketValue: -5000 }])), { params });
    expect(res.status).toBe(400);
    expect(insertValues).toHaveLength(0);
  });

  it("rejects an ad-hoc holding that names nothing", async () => {
    const res = await POST(req(adHocBody([{ shares: 100, price: 50 }])), { params });
    expect(res.status).toBe(400);
    expect(insertValues).toHaveLength(0);
  });

  it("rejects an unknown key on an ad-hoc holding", async () => {
    const res = await POST(req(adHocBody([{ ticker: "SPY", quantity: 100 }])), { params });
    expect(res.status).toBe(400);
    expect(insertValues).toHaveLength(0);
  });

  it("caps an ad-hoc portfolio at 500 holdings", async () => {
    // `maxDuration = 300` on an authenticated route: an unbounded array is a
    // compute-exhaustion surface, not just an odd request.
    const holdings = Array.from({ length: 501 }, (_, i) => ({
      ticker: `T${i}`,
      marketValue: 100,
    }));
    const res = await POST(req(adHocBody(holdings)), { params });
    expect(res.status).toBe(400);
    expect(insertValues).toHaveLength(0);
  });

  it("accepts a well-formed ad-hoc portfolio", async () => {
    const res = await POST(
      req(adHocBody([{ ticker: "SPY", shares: 100, price: 50 }, { name: "Cash", marketValue: 5000 }])),
      { params },
    );
    expect(res.status).toBe(200);
    expect(insertValues).toHaveLength(1);
  });

  it("400s on a body that isn't JSON", async () => {
    const res = await POST(
      new Request("http://t/api", { method: "POST", body: "not json" }) as never,
      { params },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid JSON body" });
    expect(insertValues).toHaveLength(0);
  });

  it("422s with the ticker list when the target can't be classified", async () => {
    vi.mocked(computeProposalSnapshot).mockRejectedValueOnce(
      new UnclassifiableTickerError(["ZZZZ", "QQQQ"]),
    );
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ unresolvedTickers: ["ZZZZ", "QQQQ"] });
  });

  it("404s a view-only share recipient and writes nothing", async () => {
    // A cross-firm share can be read-only. Creating is a mutation, so a
    // recipient without edit is turned away exactly like a missing client.
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "view",
      firmId: "firm_1",
      access: "shared",
    });
    const res = await POST(req(validBody), { params });
    expect(res.status).toBe(404);
    expect(insertValues).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
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

  it("lets a view-only share recipient read", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({
      ok: true,
      permission: "view",
      firmId: "firm_1",
      access: "shared",
    });
    const res = await GET(new Request("http://t/api") as never, { params });
    expect(res.status).toBe(200);
  });

  it("returns 404 when the caller cannot reach the client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await GET(new Request("http://t/api") as never, { params });
    expect(res.status).toBe(404);
  });
});
