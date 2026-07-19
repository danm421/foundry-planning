// Route tests for the draft workbench API surface (Task 6) plus the Task 8
// preview route:
//   GET/POST/PATCH /api/clients/[id]/divorce-plan
//   PUT            /api/clients/[id]/divorce-plan/allocations
//   POST           /api/clients/[id]/divorce-plan/abandon
//   POST           /api/clients/[id]/divorce-plan/preview
//
// Mocked-Clerk pattern mirrors accounts-writes.test.ts / revocable-trusts
// route.test.ts: a single fixed auth() identity acting as an org:admin in the
// married fixture's firm (TEST_FIRM_ID), with sessionClaims.org_public_metadata
// = { is_founder: true } so requireActiveSubscriptionForFirm's fast path
// (own-org, no Clerk call) passes. Cross-firm behavior is exercised by
// pointing the route at a client row that belongs to a DIFFERENT firm — same
// mechanism the revocable-trusts route test uses — rather than swapping the
// mocked orgId per test.
//
// Hits the real Neon dev branch via createMarriedFixture (Task 4's fixture)
// and skips cleanly without a DB so it never adds to the no-delta failing set
// in CI.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, crmHouseholds, crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createMarriedFixture, destroyFixture, TEST_FIRM_ID, type MarriedFixture } from "@/lib/divorce/__tests__/fixtures";

const TEST_USER_ID = "user_test_divorce_routes";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({
    userId: TEST_USER_ID,
    orgId: TEST_FIRM_ID,
    orgRole: "org:admin",
    sessionClaims: { org_public_metadata: { is_founder: true } },
  })),
}));

// Imported AFTER the mock so the route modules pick up the mocked auth().
import { GET, POST, PATCH } from "../route";
import { PUT } from "../allocations/route";
import { POST as ABANDON } from "../abandon/route";
import { POST as PREVIEW } from "../preview/route";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

function makeReq(method: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  return new Request("http://test/api", init) as unknown as NextRequest;
}

d("divorce-plan routes", () => {
  let f: MarriedFixture;

  beforeAll(async () => {
    f = await createMarriedFixture();
  });

  afterAll(async () => {
    await destroyFixture(f);
  });

  it("GET before any draft exists -> 404 { error: 'no_draft' }", async () => {
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: f.clientId }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("no_draft");
  });

  it("POST creates a draft -> 200 with a WorkbenchPayload (plan + divisible objects)", async () => {
    const res = await POST(makeReq("POST"), { params: Promise.resolve({ id: f.clientId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.clientId).toBe(f.clientId);
    expect(body.plan.status).toBe("draft");
    expect(Array.isArray(body.objects)).toBe(true);
    expect(body.objects.some((o: { id: string }) => o.id === f.ids.jointBrokerage)).toBe(true);
    expect(body.people.primaryName).toContain("Taylor");
    expect(body.people.spouseName).toContain("Jordan");
  });

  it("GET after create -> 200 with the same draft", async () => {
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: f.clientId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.clientId).toBe(f.clientId);
    expect(body.plan.status).toBe("draft");
  });

  it("PATCH updates spouseFilingStatus to head_of_household", async () => {
    const res = await PATCH(makeReq("PATCH", { spouseFilingStatus: "head_of_household" }), {
      params: Promise.resolve({ id: f.clientId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.spouseFilingStatus).toBe("head_of_household");
  });

  it("PUT writes an allocation (50/50 split on the joint brokerage)", async () => {
    const res = await PUT(
      makeReq("PUT", {
        items: [
          {
            targetKind: "account",
            targetId: f.ids.jointBrokerage,
            disposition: "split",
            splitPercentToSpouse: 50,
          },
        ],
      }),
      { params: Promise.resolve({ id: f.clientId }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const alloc = body.allocations.find(
      (a: { targetId: string }) => a.targetId === f.ids.jointBrokerage
    );
    expect(alloc).toBeTruthy();
    expect(alloc.disposition).toBe("split");
    expect(Number(alloc.splitPercentToSpouse)).toBe(50);
  });

  it("PUT split on the 529 -> 422 { code: 'invalid_disposition' } (education_savings isn't splittable)", async () => {
    const res = await PUT(
      makeReq("PUT", {
        items: [
          {
            targetKind: "account",
            targetId: f.ids.plan529,
            disposition: "split",
            splitPercentToSpouse: 50,
          },
        ],
      }),
      { params: Promise.resolve({ id: f.clientId }) }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("invalid_disposition");
  });

  it("PUT confirms the remaining joint objects (house, livingExpense, jointMortgage) to primary", async () => {
    const res = await PUT(
      makeReq("PUT", {
        items: [
          { targetKind: "account", targetId: f.ids.house, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "expense", targetId: f.ids.livingExpense, disposition: "primary", splitPercentToSpouse: null },
          { targetKind: "liability", targetId: f.ids.jointMortgage, disposition: "primary", splitPercentToSpouse: null },
        ],
      }),
      { params: Promise.resolve({ id: f.clientId }) }
    );
    expect(res.status).toBe(200);
  });

  it("POST preview on the confirmed fixture -> 200 { blockers: [], actions non-empty }", async () => {
    const res = await PREVIEW(makeReq("POST"), { params: Promise.resolve({ id: f.clientId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blockers).toEqual([]);
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.actions.length).toBeGreaterThan(0);
  });

  it("abandon flips the draft to abandoned -> a subsequent GET 404s with no_draft", async () => {
    const res = await ABANDON(makeReq("POST"), { params: Promise.resolve({ id: f.clientId }) });
    expect(res.status).toBe(200);

    const getRes = await GET(makeReq("GET"), { params: Promise.resolve({ id: f.clientId }) });
    expect(getRes.status).toBe(404);
    const body = await getRes.json();
    expect(body.error).toBe("no_draft");
  });
});

// ── Cross-firm caller ─────────────────────────────────────────────────────
// The mocked auth() identity above belongs to TEST_FIRM_ID. A client that
// belongs to a DIFFERENT firm (no cross-org share configured) must 404 on
// read and 403 on every mutation — the same own-firm/shared-access split the
// revocable-trusts route test exercises.
d("divorce-plan routes — cross-firm caller", () => {
  const OTHER_FIRM_ID = "org_other_firm_divorce_routes";
  let otherClientId: string;
  let otherHouseholdId: string;

  beforeAll(async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({
        firmId: OTHER_FIRM_ID,
        advisorId: "adv_other_divorce_routes",
        name: "Other Firm Household",
        status: "active",
      })
      .returning({ id: crmHouseholds.id });
    otherHouseholdId = hh.id;

    await db.insert(crmHouseholdContacts).values({
      householdId: otherHouseholdId,
      role: "primary",
      firstName: "Other",
      lastName: "Client",
      dateOfBirth: "1970-01-01",
    });

    const [client] = await db
      .insert(clients)
      .values({
        firmId: OTHER_FIRM_ID,
        advisorId: "adv_other_divorce_routes",
        crmHouseholdId: otherHouseholdId,
        retirementAge: 65,
        planEndAge: 95,
        filingStatus: "married_joint",
      })
      .returning({ id: clients.id });
    otherClientId = client.id;
  });

  afterAll(async () => {
    await db.delete(clients).where(eq(clients.id, otherClientId));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.id, otherHouseholdId));
  });

  it("GET -> 404", async () => {
    const res = await GET(makeReq("GET"), { params: Promise.resolve({ id: otherClientId }) });
    expect(res.status).toBe(404);
  });

  it("POST -> 403", async () => {
    const res = await POST(makeReq("POST"), { params: Promise.resolve({ id: otherClientId }) });
    expect(res.status).toBe(403);
  });

  it("PATCH -> 403", async () => {
    const res = await PATCH(makeReq("PATCH", { spouseFilingStatus: "single" }), {
      params: Promise.resolve({ id: otherClientId }),
    });
    expect(res.status).toBe(403);
  });

  it("PUT allocations -> 403", async () => {
    const res = await PUT(
      makeReq("PUT", {
        items: [
          { targetKind: "account", targetId: otherClientId, disposition: "primary", splitPercentToSpouse: null },
        ],
      }),
      { params: Promise.resolve({ id: otherClientId }) }
    );
    expect(res.status).toBe(403);
  });

  it("abandon -> 403", async () => {
    const res = await ABANDON(makeReq("POST"), { params: Promise.resolve({ id: otherClientId }) });
    expect(res.status).toBe(403);
  });

  // Preview uses verifyClientAccess (like GET) rather than the throw-based
  // requireClientEditAccess the other mutations use, so a caller with no
  // access at all gets the same existence-hiding 404 as GET, not 403.
  it("preview -> 404", async () => {
    const res = await PREVIEW(makeReq("POST"), { params: Promise.resolve({ id: otherClientId }) });
    expect(res.status).toBe(404);
  });
});
