import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue of results returned by successive `db.select()...where()` chains.
const selectQueue: unknown[] = [];
const mockExecute = vi.fn();
vi.mock("@/db", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.innerJoin = () => c;
    c.where = () => Promise.resolve(selectQueue.shift());
    return c;
  };
  return { db: { select: () => chain(), execute: (q: unknown) => mockExecute(q) } };
});

const mockFetchEodCloses = vi.fn();
vi.mock("@/lib/investments/quote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/investments/quote")>()),
  fetchEodCloses: (...a: unknown[]) => mockFetchEodCloses(...a),
}));

const mockSync = vi.fn();
vi.mock("@/lib/investments/sync-account-from-holdings", () => ({
  syncAccountFromHoldings: (...a: unknown[]) => mockSync(...a),
}));

const mockRequireOrgId = vi.fn();
vi.mock("@/lib/db-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db-helpers")>()),
  requireOrgId: () => mockRequireOrgId(),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockRecordAudit(...a) }));

// Phase 1b: routes gate via verifyClientAccess → auth() from @clerk/nextjs/server.
// Mock it so the staff-scope check is a no-op (undefined orgRole ⇒ non-staff ⇒
// access turns purely on the firm-scoped clients query the test already drives).
vi.mock("@clerk/nextjs/server", () => ({
  // orgId = "firm_1" so the real verifyClientAccess own-firm path
  // (`client.firmId === orgId`) matches the mocked client row's firmId below.
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_1" }),
}));

import { POST } from "../route";
import { UnauthorizedError } from "@/lib/db-helpers";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost", { method: "POST" }) as never;

beforeEach(() => {
  selectQueue.length = 0;
  mockExecute.mockReset().mockResolvedValue(undefined);
  mockFetchEodCloses.mockReset();
  mockSync.mockReset().mockResolvedValue(undefined);
  mockRequireOrgId.mockReset().mockResolvedValue("firm_1");
  mockRecordAudit.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/clients/[id]/holdings/refresh", () => {
  it("401 when unauthorized", async () => {
    mockRequireOrgId.mockRejectedValue(new UnauthorizedError());
    const res = await POST(req(), ctx("c1"));
    expect(res.status).toBe(401);
  });

  it("404 when the client is not in the caller's firm", async () => {
    selectQueue.push([]); // client check → no row
    const res = await POST(req(), ctx("c1"));
    expect(res.status).toBe(404);
  });

  it("refreshes the client's holdings, returns a summary, records audit", async () => {
    selectQueue.push([{ id: "c1", firmId: "firm_1" }]); // client-in-firm check (verifyClientAccess own-firm path)
    selectQueue.push([
      { id: "h1", accountId: "a1", displayTicker: "VTI", priceAsOf: "2026-05-28", deriveFromHoldings: true },
      { id: "h2", accountId: "a2", displayTicker: "FOOBAR", priceAsOf: null, deriveFromHoldings: true },
    ]);
    mockFetchEodCloses.mockResolvedValue(
      new Map([["VTI.US", { price: 372.54, asOf: "2026-05-29" }]]),
    );

    const res = await POST(req(), ctx("c1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdingsUpdated).toBe(1);
    expect(body.tickersMissing).toEqual(["FOOBAR"]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith("a1");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "client.holdings.refresh", clientId: "c1" }),
    );
  });
});
