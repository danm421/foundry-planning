// A change the shared writer refuses on its merits (a scenario gift to a
// revocable trust) is the caller's mistake, so the route answers 400 with the
// writer's reason — the same answer the base gift routes give — not a 500.
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const SCENARIO_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/db-helpers", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/db-helpers")>()),
  requireOrgAndUser: vi.fn(async () => ({ orgId: "org_test", userId: "user_test" })),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn(async () => ({ firmId: "org_test", access: "own" })),
}));
vi.mock("@/lib/authz", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/authz")>()),
  requireActiveSubscriptionForFirm: vi.fn(async () => undefined),
}));
vi.mock("@/lib/scenario/route-scope", () => ({
  assertScenarioRouteScope: vi.fn(async () => ({ kind: "hit" })),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/scenario/changes-writer", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/scenario/changes-writer")>();
  return {
    ...actual,
    applyEntityAdd: vi.fn(async () => {
      throw new actual.ScenarioChangeRejectedError(
        "Gifts to revocable trusts are not completed gifts",
      );
    }),
  };
});

import { POST } from "../route";

describe("POST scenario changes — a refused change", () => {
  it("answers 400 with the writer's reason", async () => {
    const req = new NextRequest(
      `http://localhost/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes`,
      {
        method: "POST",
        body: JSON.stringify({
          op: "add",
          targetKind: "gift",
          entity: { id: "44444444-4444-4444-8444-444444444444", kind: "cash-once" },
        }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: CLIENT_ID, sid: SCENARIO_ID }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Gifts to revocable trusts are not completed gifts",
    });
  });
});
