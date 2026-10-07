import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  assertExt: vi.fn(),
  assertFm: vi.fn(),
  existing: [] as unknown[],
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: vi.fn(async () => ({ orgId: "org_1", userId: "user_1" })),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(async () => ({ firmId: "firm_1", access: "edit" })),
  verifyClientAccess: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn(async () => undefined),
  authErrorResponse: vi.fn(() => null),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/clients/cross-firm-audit", () => ({ crossFirmAuditMeta: vi.fn(() => ({})) }));
vi.mock("@/lib/db-scoping", () => ({
  assertEntitiesInClient: vi.fn(async () => ({ ok: true })),
  assertExternalBeneficiariesInClient: mocks.assertExt,
  assertFamilyMembersInClient: mocks.assertFm,
}));
vi.mock("@/db", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown) => res(mocks.existing);
    return c;
  };
  return { db: { select: () => chain(), transaction: async () => { throw new Error("reached the write"); } } };
});

const splitInterest = {
  inceptionYear: 2026,
  inceptionValue: 100000,
  payoutType: "unitrust",
  payoutPercent: 0.05,
  irc7520Rate: 0.05,
  termType: "years",
  termYears: 10,
  charityId: FOREIGN,
};

import { PUT } from "../route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/clients/x/entities/y", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: CLIENT, entityId: ENTITY }) };
const patch = { splitInterest: { ...splitInterest, origin: "existing", originalIncomeInterest: 1, originalRemainderInterest: 1 } };

describe("PUT entities split-interest references", () => {
  beforeEach(() => {
    mocks.existing = [{ id: ENTITY, clientId: CLIENT, entityType: "trust", trustSubType: "clt", grantor: "client" }];
    mocks.assertExt.mockReset().mockResolvedValue({ ok: true });
    mocks.assertFm.mockReset().mockResolvedValue({ ok: true });
  });

  it("rejects a charity that belongs to another client", async () => {
    mocks.assertExt.mockResolvedValue({ ok: false, reason: "External beneficiary x not owned by this client" });
    const res = await PUT(req(patch), params);
    expect(mocks.assertExt).toHaveBeenCalledWith(CLIENT, [FOREIGN]);
    expect(res.status).toBe(400);
  });

  it("rejects a measuring life that belongs to another client", async () => {
    mocks.assertFm.mockResolvedValue({ ok: false, reason: "Family member x not owned by this client" });
    const body = { splitInterest: { ...patch.splitInterest, measuringLife1Id: FOREIGN } };
    const res = await PUT(req(body), params);
    expect(mocks.assertFm).toHaveBeenCalledWith(CLIENT, [FOREIGN, undefined]);
    expect(res.status).toBe(400);
  });
});
