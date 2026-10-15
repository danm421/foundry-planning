/**
 * PUT /api/clients/[id]/entities/[entityId]/beneficiaries
 *
 * The trust is looked up before the body is read: a missing entity answers
 * 404 and one that isn't a trust 400, whatever was sent — never a 500 for a
 * body that isn't JSON.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: vi.fn(),
  requireClientEditAccess: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/db-scoping", () => ({ assertEntitiesInClient: vi.fn() }));

// Every select finds `rows.current` — the entity the trust check reads.
const rows: { current: unknown[] } = { current: [] };
const transaction = vi.fn();
vi.mock("@/db", () => {
  const result = () => ({
    where: () => result(),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows.current).then(r),
  });
  return {
    db: {
      select: () => ({ from: () => result() }),
      transaction: (...a: unknown[]) => transaction(...a),
    },
  };
});

import { PUT } from "../route";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const ENTITY = "33333333-3333-3333-3333-333333333333";
const ctx = { params: Promise.resolve({ id: CLIENT, entityId: ENTITY }) };
const notJson = () => new Request("http://t/beneficiaries", { method: "PUT", body: "not json" }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  const access = { ok: true, permission: "edit", firmId: "firm-1", access: "own" } as never;
  vi.mocked(requireClientEditAccess).mockResolvedValue(access);
  vi.mocked(verifyClientAccess).mockResolvedValue(access);
});

describe("PUT trust beneficiaries — the trust is checked before the body is read", () => {
  it("404s on a missing entity, even for a body that isn't JSON", async () => {
    rows.current = [];
    const res = await PUT(notJson(), ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("400s on an entity that isn't a trust, even for a body that isn't JSON", async () => {
    rows.current = [{ id: ENTITY, entityType: "llc" }];
    const res = await PUT(notJson(), ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Entity is not a trust" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
