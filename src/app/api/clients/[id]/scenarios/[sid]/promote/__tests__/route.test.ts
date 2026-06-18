// src/app/api/clients/[id]/scenarios/[sid]/promote/__tests__/route.test.ts
//
// Unit tests for the promote route. Task 17d: uses requireOrgAndUser +
// requireClientEditAccess + requireActiveSubscriptionForFirm instead of
// requireOrgId + assertScenarioRouteScope-only. Mocks at the lib boundary.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn(),
  requireOrgAndUser: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  authErrorResponse: vi.fn(() => null),
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "user_123", orgId: "firm_test" })) }));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(),
}));
vi.mock("@/lib/scenario/route-scope", () => ({ assertScenarioRouteScope: vi.fn() }));
vi.mock("@/lib/scenario/promote-to-base", () => ({
  promoteScenarioToBase: vi.fn(),
  PromoteError: class PromoteError extends Error {
    constructor(
      public code: string,
      m: string,
    ) {
      super(m);
      this.name = "PromoteError";
    }
  },
}));

import { POST } from "../route";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm } from "@/lib/authz";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import { promoteScenarioToBase, PromoteError } from "@/lib/scenario/promote-to-base";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";
const SCENARIO_ID = "00000000-0000-4000-8000-000000000002";
const FIRM_ID = "00000000-0000-4000-8000-000000000099";

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/promote`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  ) as never;
}

const ctx = { params: Promise.resolve({ id: CLIENT_ID, sid: SCENARIO_ID }) };

const okScope = (overrides: Record<string, unknown> = {}) => ({
  kind: "ok" as const,
  scenario: { id: SCENARIO_ID, name: "Aggressive", isBaseCase: false, ...overrides },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgAndUser).mockResolvedValue({ orgId: "caller_org", userId: "user_123" });
  vi.mocked(requireClientEditAccess).mockResolvedValue({ firmId: FIRM_ID, access: "own" as const } as never);
  vi.mocked(requireActiveSubscriptionForFirm).mockResolvedValue(undefined);
});

describe("POST promote route", () => {
  it("rejects promoting the base case (400)", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue(
      okScope({ isBaseCase: true }) as never,
    );
    const res = await POST(makeRequest({ toggleState: {} }), ctx);
    expect(res.status).toBe(400);
    expect(promoteScenarioToBase).not.toHaveBeenCalled();
  });

  it("returns the scope miss response (404) when scenario not found in client", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue({
      kind: "miss",
      response: NextResponse.json({ error: "not found" }, { status: 404 }),
    } as never);
    const res = await POST(makeRequest({}), ctx);
    expect(res.status).toBe(404);
    expect(promoteScenarioToBase).not.toHaveBeenCalled();
  });

  it("promotes on the happy path (200) and forwards the toggle state", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue(okScope() as never);
    vi.mocked(promoteScenarioToBase).mockResolvedValue({
      snapshotId: "snap-1",
      deletedScenarioCount: 2,
      counts: { account: 1 },
      notes: { kept: 0, dropped: 0 },
    });
    const res = await POST(makeRequest({ toggleState: { g1: true } }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, snapshotId: "snap-1", deletedScenarioCount: 2 });
    expect(promoteScenarioToBase).toHaveBeenCalledTimes(1);
    expect(vi.mocked(promoteScenarioToBase).mock.calls[0][0]).toMatchObject({
      clientId: CLIENT_ID,
      firmId: FIRM_ID,
      scenarioId: SCENARIO_ID,
      scenarioName: "Aggressive",
      toggleState: { g1: true },
    });
  });

  it("maps PromoteError(no_base) to 409", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue(okScope() as never);
    vi.mocked(promoteScenarioToBase).mockRejectedValue(
      new PromoteError("no_base", "Client has no base case scenario"),
    );
    const res = await POST(makeRequest({}), ctx);
    expect(res.status).toBe(409);
  });

  it("rejects a malformed toggleState body (400)", async () => {
    vi.mocked(assertScenarioRouteScope).mockResolvedValue(okScope() as never);
    const res = await POST(makeRequest({ toggleState: { g1: "yes" } }), ctx);
    expect(res.status).toBe(400);
    expect(promoteScenarioToBase).not.toHaveBeenCalled();
  });
});
