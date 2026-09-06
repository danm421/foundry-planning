/**
 * PUT /api/clients/[id]/entities/[entityId]/beneficiaries
 *
 * A trust beneficiary can itself be a trust, named by `entityIdRef` from the
 * request body. The sibling ACCOUNT beneficiaries route asserts that id against
 * the client; this one did not, so a foreign entity id landed in
 * `beneficiary_designations` unchecked — a dangling cross-client reference that
 * the owning firm's later delete cascades away.
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

// `verifyClientAndTrust` reads the target entity; the transaction below the
// assert is never reached in these cases, so one fixed row is enough.
const transaction = vi.fn();
vi.mock("@/db", () => {
  const result = (rows: unknown[]) => ({
    where: () => result(rows),
    limit: () => result(rows),
    orderBy: () => result(rows),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      select: () => ({ from: () => result([{ id: "trust-1", entityType: "trust" }]) }),
      transaction: (...a: unknown[]) => transaction(...a),
    },
  };
});

import { PUT } from "../route";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { assertEntitiesInClient } from "@/lib/db-scoping";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const TRUST = "33333333-3333-3333-3333-333333333333";
// A real v4: `entityIdRef` is validated with Zod's RFC-4122 `.uuid()`, so a
// shaped-but-invalid id 400s on the schema and never reaches the assert.
const FOREIGN_ENTITY = "99999999-9999-4999-8999-999999999999";

const ctx = { params: Promise.resolve({ id: CLIENT, entityId: TRUST }) };
const req = (body: unknown) =>
  new Request("http://t/beneficiaries", { method: "PUT", body: JSON.stringify(body) }) as never;

const designation = (entityIdRef: string) => [
  { tier: "primary", entityIdRef, percentage: 100, sortOrder: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "firm-1",
    access: "own",
  } as never);
  vi.mocked(verifyClientAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "firm-1",
    access: "own",
  } as never);
  vi.mocked(assertEntitiesInClient).mockResolvedValue({ ok: true });
});

describe("PUT trust beneficiaries — entityIdRef tenancy", () => {
  it("400s on an entityIdRef that belongs to another client, before any write", async () => {
    vi.mocked(assertEntitiesInClient).mockResolvedValue({
      ok: false,
      reason: "Entity not in this client",
    });

    const res = await PUT(req(designation(FOREIGN_ENTITY)), ctx);

    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("checks the referenced entity against THIS client", async () => {
    await PUT(req(designation(FOREIGN_ENTITY)), ctx);
    expect(assertEntitiesInClient).toHaveBeenCalledWith(CLIENT, [FOREIGN_ENTITY]);
  });
});
