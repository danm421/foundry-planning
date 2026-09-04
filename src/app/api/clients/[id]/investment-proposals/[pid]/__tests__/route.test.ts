import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

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
  computeProposalSnapshot: vi.fn(async () => ({ version: 1, computedAt: "recomputed" })),
}));

const setCalls: Record<string, unknown>[] = [];
const deleteCalls: unknown[] = [];
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setCalls.push(values);
        return { where: async () => undefined };
      },
    }),
    delete: () => ({
      where: async (cond: unknown) => {
        deleteCalls.push(cond);
      },
    }),
  },
}));

vi.mock("@/lib/investments/proposals/queries", () => ({
  listProposals: vi.fn(async () => []),
  getProposal: vi.fn(async () => existing),
  loadExpenseRatios: vi.fn(async () => new Map()),
}));

import { GET, PUT, DELETE } from "../route";
import { verifyClientAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { getProposal } from "@/lib/investments/proposals/queries";
import { computeProposalSnapshot } from "@/lib/investments/proposals/compute";
import { UnclassifiableTickerError } from "@/lib/investments/rebalance/resolve-target";

// RFC 9562-valid: Zod 4's `.uuid()` checks the version and variant nibbles.
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PORTFOLIO_ID = "33333333-3333-4333-8333-333333333333";

/** The stored row every handler reads before it writes. */
const existing = {
  id: "p1",
  name: "Move to Core Moderate",
  status: "draft" as const,
  source: { accountIds: [ACCOUNT_ID] },
  target: { portfolioId: PORTFOLIO_ID },
  targetLabel: "Core Moderate",
  advisoryFeeCurrent: 0.009,
  advisoryFeeProposed: 0.0075,
  overrideLtcgRate: null,
  notes: "Presented at the March review",
  result: { version: 1, computedAt: "2026-01-01T00:00:00.000Z" },
  computedAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} as unknown as NonNullable<Awaited<ReturnType<typeof getProposal>>>;

const VIEW_ONLY = {
  ok: true,
  permission: "view",
  firmId: "firm_1",
  access: "shared",
} as const;

const params = Promise.resolve({ id: "client_1", pid: "p1" });
const put = (body: unknown) =>
  new Request("http://t/api", { method: "PUT", body: JSON.stringify(body) }) as never;
const bare = () => new Request("http://t/api") as never;

beforeEach(() => {
  vi.clearAllMocks();
  setCalls.length = 0;
  deleteCalls.length = 0;
});

describe("GET /investment-proposals/[pid]", () => {
  it("returns the proposal it was asked for", async () => {
    const res = await GET(bare(), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ proposal: { id: "p1", name: "Move to Core Moderate" } });
    expect(getProposal).toHaveBeenCalledWith("client_1", "p1");
  });

  it("lets a view-only share recipient read", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce(VIEW_ONLY);
    const res = await GET(bare(), { params });
    expect(res.status).toBe(200);
  });

  it("404s when the proposal is not this client's", async () => {
    // getProposal filters on clientId, so another client's row resolves null.
    vi.mocked(getProposal).mockResolvedValueOnce(null);
    const res = await GET(bare(), { params });
    expect(res.status).toBe(404);
  });

  it("404s when the caller cannot reach the client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await GET(bare(), { params });
    expect(res.status).toBe(404);
  });
});

describe("PUT /investment-proposals/[pid]", () => {
  it("does not recompute when recompute is false", async () => {
    const res = await PUT(put({ name: "Renamed", recompute: false }), { params });
    expect(res.status).toBe(200);
    expect(computeProposalSnapshot).not.toHaveBeenCalled();
    // The frozen snapshot and its timestamp must not be touched.
    expect(setCalls[0]).not.toHaveProperty("result");
    expect(setCalls[0]).not.toHaveProperty("computedAt");
    expect(await res.json()).toMatchObject({ computedAt: existing.computedAt.toISOString() });
  });

  it("does not recompute when recompute is omitted", async () => {
    await PUT(put({ name: "Renamed" }), { params });
    expect(computeProposalSnapshot).not.toHaveBeenCalled();
  });

  it("recomputes from the merged inputs and writes the new computedAt", async () => {
    const res = await PUT(put({ recompute: true }), { params });

    expect(res.status).toBe(200);
    expect(computeProposalSnapshot).toHaveBeenCalledTimes(1);
    // Inputs the request didn't supply come off the stored proposal.
    expect(vi.mocked(computeProposalSnapshot).mock.calls[0][0]).toMatchObject({
      clientId: "client_1",
      firmId: "firm_1",
      request: { accountIds: [ACCOUNT_ID], target: { portfolioId: PORTFOLIO_ID } },
      advisoryFeeCurrent: 0.009,
      advisoryFeeProposed: 0.0075,
    });

    expect(setCalls[0].result).toEqual({ version: 1, computedAt: "recomputed" });
    expect(setCalls[0].computedAt).toBeInstanceOf(Date);
    expect((setCalls[0].computedAt as Date).getTime()).toBeGreaterThan(
      existing.computedAt.getTime(),
    );
  });

  it("400s when a snapshot input changes without recompute", async () => {
    // Otherwise the row would be labelled Core Aggressive while `result` still
    // held Core Moderate's numbers, with nothing marking it stale.
    const res = await PUT(put({ target: { portfolioId: OTHER_PORTFOLIO_ID } }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("target");
    expect(setCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400s when overrideLtcgRate changes without recompute", async () => {
    const res = await PUT(put({ overrideLtcgRate: 0.15 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("overrideLtcgRate");
    expect(setCalls).toHaveLength(0);
  });

  it("400s when an advisory fee changes without recompute", async () => {
    // Both fees feed buildFeeComparison and the break-even, so accepting one
    // without a recompute leaves the row's fee column contradicting its own
    // frozen `fees` block — the list and the PDF would print different fees.
    const res = await PUT(put({ advisoryFeeCurrent: 0.005 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("advisoryFeeCurrent");
    expect(setCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400s when a fee is cleared without recompute", async () => {
    const res = await PUT(put({ advisoryFeeProposed: null }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("advisoryFeeProposed");
    expect(setCalls).toHaveLength(0);
  });

  it("accepts a fee-only change when recompute is true", async () => {
    // What the builder's Save & close sends for a pending fee edit.
    const res = await PUT(put({ advisoryFeeCurrent: 0.005, recompute: true }), { params });
    expect(res.status).toBe(200);
    expect(setCalls[0]).toMatchObject({ advisoryFeeCurrent: "0.005" });
    expect(vi.mocked(computeProposalSnapshot).mock.calls[0][0]).toMatchObject({
      advisoryFeeCurrent: 0.005,
    });
  });

  it("accepts the same input change when recompute is true", async () => {
    const target = { portfolioId: OTHER_PORTFOLIO_ID };
    const res = await PUT(put({ target, recompute: true }), { params });

    expect(res.status).toBe(200);
    expect(setCalls[0]).toMatchObject({ target });
    // The new target, not the stored one, is what gets recomputed.
    expect(vi.mocked(computeProposalSnapshot).mock.calls[0][0]).toMatchObject({
      request: { target },
    });
  });

  it("stamps updatedAt so an edited proposal sorts to the top of the list", async () => {
    // investment_proposals.updatedAt has no $onUpdate and the client index
    // sorts on it, so the handler has to set it explicitly.
    const before = Date.now();
    await PUT(put({ name: "Renamed" }), { params });

    expect(setCalls[0].updatedAt).toBeInstanceOf(Date);
    const stamped = (setCalls[0].updatedAt as Date).getTime();
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeGreaterThan(existing.updatedAt.getTime());
  });

  it("keeps stored fees and notes a partial edit never mentioned", async () => {
    await PUT(put({ name: "Renamed" }), { params });
    expect(setCalls[0]).toMatchObject({
      advisoryFeeCurrent: "0.009",
      advisoryFeeProposed: "0.0075",
    });
    expect(setCalls[0]).not.toHaveProperty("notes");
  });

  it("clears a fee the caller explicitly nulled", async () => {
    // A cleared fee changes the snapshot, so it travels with `recompute` — but
    // the null still has to reach the column rather than being read as "absent".
    await PUT(put({ advisoryFeeProposed: null, recompute: true }), { params });
    expect(setCalls[0]).toMatchObject({ advisoryFeeCurrent: "0.009", advisoryFeeProposed: null });
  });

  it("audits the update", async () => {
    await PUT(put({ name: "Renamed" }), { params });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "investment_proposal.update",
        clientId: "client_1",
        firmId: "firm_1",
      }),
    );
  });

  it("rejects a body that fails the schema", async () => {
    const res = await PUT(put({ status: "archived" }), { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("issues");
    expect(setCalls).toHaveLength(0);
  });

  it("400s on a body that isn't JSON", async () => {
    const res = await PUT(
      new Request("http://t/api", { method: "PUT", body: "not json" }) as never,
      { params },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid JSON body" });
    expect(setCalls).toHaveLength(0);
  });

  it("422s with the ticker list when a recompute can't classify the target", async () => {
    vi.mocked(computeProposalSnapshot).mockRejectedValueOnce(
      new UnclassifiableTickerError(["ZZZZ"]),
    );
    const res = await PUT(put({ recompute: true }), { params });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ unresolvedTickers: ["ZZZZ"] });
  });

  it("404s a view-only share recipient and writes nothing", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce(VIEW_ONLY);
    const res = await PUT(put({ name: "Renamed" }), { params });
    expect(res.status).toBe(404);
    expect(setCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("404s and writes nothing when the proposal is not this client's", async () => {
    vi.mocked(getProposal).mockResolvedValueOnce(null);
    const res = await PUT(put({ name: "Renamed" }), { params });
    expect(res.status).toBe(404);
    expect(setCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("404s when the caller cannot reach the client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await PUT(put({ name: "Renamed" }), { params });
    expect(res.status).toBe(404);
    expect(setCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("DELETE /investment-proposals/[pid]", () => {
  it("deletes the row and audits it", async () => {
    const res = await DELETE(bare(), { params });
    expect(res.status).toBe(204);
    expect(deleteCalls).toHaveLength(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "investment_proposal.delete",
        clientId: "client_1",
        firmId: "firm_1",
      }),
    );
  });

  it("404s a view-only share recipient and deletes nothing", async () => {
    // Destructive and unrecoverable — a recipient denied edit must not reach it.
    vi.mocked(verifyClientAccess).mockResolvedValueOnce(VIEW_ONLY);
    const res = await DELETE(bare(), { params });
    expect(res.status).toBe(404);
    expect(deleteCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("404s and deletes nothing when the proposal is not this client's", async () => {
    vi.mocked(getProposal).mockResolvedValueOnce(null);
    const res = await DELETE(bare(), { params });
    expect(res.status).toBe(404);
    expect(deleteCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("404s when the caller cannot reach the client", async () => {
    vi.mocked(verifyClientAccess).mockResolvedValueOnce({ ok: false } as never);
    const res = await DELETE(bare(), { params });
    expect(res.status).toBe(404);
    expect(deleteCalls).toHaveLength(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
