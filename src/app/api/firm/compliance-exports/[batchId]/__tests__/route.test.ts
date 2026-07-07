import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ requireAdmin: vi.fn(), orgId: vi.fn(), getBatch: vi.fn(), counts: vi.fn() }));

vi.mock("@/lib/authz", async (orig) => {
  const actual = await orig<typeof import("@/lib/authz")>();
  return { ...actual, requireOrgAdminOrOwner: () => m.requireAdmin() };
});
vi.mock("@/lib/db-helpers", async (orig) => {
  const actual = await orig<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: () => m.orgId() };
});
vi.mock("@/lib/compliance-export/batches", () => ({
  getBatchForFirm: (...a: unknown[]) => m.getBatch(...a),
  childStatusCounts: (...a: unknown[]) => m.counts(...a),
}));

import { GET } from "../route";

const ctx = (batchId: string) => ({ params: Promise.resolve({ batchId }) });

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.requireAdmin.mockResolvedValue(undefined);
  m.orgId.mockResolvedValue("f1");
});

describe("GET /api/firm/compliance-exports/[batchId]", () => {
  it("404 when the batch is not in this firm", async () => {
    m.getBatch.mockResolvedValue(null);
    const res = await GET(new Request("http://t") as never, ctx("b1"));
    expect(res.status).toBe(404);
  });

  it("returns derived progress", async () => {
    m.getBatch.mockResolvedValue({
      id: "b1", status: "running", totalClients: 5,
      skippedClients: [{ householdId: "h9", name: "X", reason: "no base-case scenario" }],
      startedAt: null, finishedAt: null, createdAt: new Date("2026-07-07T00:00:00Z"),
    });
    m.counts.mockResolvedValue({ queued: 1, running: 1, analyzing: 0, done: 3, failed: 0 });
    const res = await GET(new Request("http://t") as never, ctx("b1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "b1", status: "running", totalClients: 5,
      done: 3, failed: 0, remaining: 2, skippedCount: 1,
    });
    expect(body.skippedClients).toHaveLength(1);
  });
});
