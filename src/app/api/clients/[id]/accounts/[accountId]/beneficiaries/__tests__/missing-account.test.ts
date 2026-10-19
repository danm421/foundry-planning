/**
 * PUT /api/clients/[id]/accounts/[accountId]/beneficiaries
 *
 * The account is looked up before the body is read: a missing account answers
 * 404 whatever was sent, never a 500 for a body that isn't JSON.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/clients/authz", () => {
  const verifyClientAccess = vi.fn();
  return {
    verifyClientAccess,
    // The write cores check access through verifyClientAccessAs: a route passes no principal, so it is this check.
    verifyClientAccessAs: (_p: unknown, id: string) => verifyClientAccess(id),
    requireClientEditAccess: vi.fn(),
  };
});
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));

// No account under this client: every select finds nothing.
const transaction = vi.fn();
vi.mock("@/db", () => {
  const result = (rows: unknown[]) => ({
    where: () => result(rows),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      select: () => ({ from: () => result([]) }),
      transaction: (...a: unknown[]) => transaction(...a),
    },
  };
});

import { PUT } from "../route";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const ACCOUNT = "33333333-3333-3333-3333-333333333333";
const ctx = { params: Promise.resolve({ id: CLIENT, accountId: ACCOUNT }) };

beforeEach(() => {
  vi.clearAllMocks();
  const access = { ok: true, permission: "edit", firmId: "firm-1", access: "own" } as never;
  vi.mocked(requireClientEditAccess).mockResolvedValue(access);
  vi.mocked(verifyClientAccess).mockResolvedValue(access);
});

describe("PUT account beneficiaries — a missing account", () => {
  it("404s before reading the body, so a body that isn't JSON still gets 404", async () => {
    const res = await PUT(new Request("http://t/beneficiaries", { method: "PUT", body: "not json" }) as never, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
