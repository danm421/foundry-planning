/**
 * POST /api/clients/[id]/insurance-policies
 *
 * `ownerRef` names the policy's owner by id, straight from the request body,
 * and the route writes it into `account_owners`. Nothing asserted the id was
 * this client's, so a policy could be owned by another client's entity — and
 * that entity's later delete cascades this firm's ownership row away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/insurance-policies/assert-owner-ref", () => ({
  assertOwnerRefInClient: vi.fn(),
}));

const transaction = vi.fn();
vi.mock("@/db", () => {
  // Only the base-case scenario lookup runs before the assert.
  const result = (rows: unknown[]) => ({
    where: () => result(rows),
    limit: () => result(rows),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      select: () => ({ from: () => result([{ id: "scenario-1", isBaseCase: true }]) }),
      transaction: (...a: unknown[]) => transaction(...a),
    },
  };
});

import { POST } from "../route";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { assertOwnerRefInClient } from "@/lib/insurance-policies/assert-owner-ref";

const CLIENT = "22222222-2222-2222-2222-222222222222";
const FOREIGN_ENTITY = "99999999-9999-9999-9999-999999999999";

const ctx = { params: Promise.resolve({ id: CLIENT }) };
const body = {
  name: "Whole life",
  policyType: "whole",
  insuredPerson: "client",
  ownerRef: { kind: "entity", id: FOREIGN_ENTITY },
  faceValue: 1_000_000,
};
const req = () =>
  new Request("http://t/insurance-policies", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgId).mockResolvedValue("firm-1");
  vi.mocked(requireClientEditAccess).mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "firm-1",
    access: "own",
  } as never);
  vi.mocked(assertOwnerRefInClient).mockResolvedValue({ ok: true });
});

describe("POST insurance-policies — ownerRef tenancy", () => {
  it("400s on an owner that belongs to another client, before any write", async () => {
    vi.mocked(assertOwnerRefInClient).mockResolvedValue({
      ok: false,
      reason: "Entity not in this client",
    });

    const res = await POST(req(), ctx);

    expect(res.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("checks the owner against THIS client", async () => {
    await POST(req(), ctx);
    expect(assertOwnerRefInClient).toHaveBeenCalledWith(CLIENT, {
      kind: "entity",
      id: FOREIGN_ENTITY,
    });
  });
});
