import { describe, it, expect, vi, beforeEach } from "vitest";

// Everything the route depends on is mocked EXCEPT summarizeEvent /
// nullActorLabel — the change-log text is the thing worth asserting, so those
// two run for real against mocked event rows.

const order = vi.hoisted(() => [] as string[]);

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test", orgId: "firm_test" }),
  currentUser: vi.fn().mockResolvedValue({
    emailAddresses: [{ emailAddress: "advisor@firm.com" }],
  }),
}));

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: vi.fn().mockImplementation((err: unknown) => {
    if (err instanceof Error && err.name === "UnauthorizedError") {
      return { status: 401, body: { error: "Unauthorized" } };
    }
    return null;
  }),
}));

const rateLimitMocks = vi.hoisted(() => ({
  checkExportPdfRateLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => rateLimitMocks);

const requireClientAccessMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clients/authz", () => ({ requireClientAccess: requireClientAccessMock }));

const capacityMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/risk/capacity", () => ({ getOrComputeCapacity: capacityMock }));

const detailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/risk/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/risk/queries")>()),
  getRiskProfileDetail: detailMock,
}));

vi.mock("@/lib/risk/detail-mismatch", () => ({
  resolveMismatchState: vi.fn().mockResolvedValue({ kind: "no_profile" }),
}));

const resolveActorsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activity/resolve-actors", () => ({ resolveActors: resolveActorsMock }));

vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: vi.fn().mockResolvedValue({
    firmName: "Ethos Financial Group",
    primaryColor: "#111111",
    logoDataUrl: null,
  }),
}));

const savePlanToVaultMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: savePlanToVaultMock }));

vi.mock("@/lib/crm/generation-runs", () => ({
  recordCompletedRun: vi.fn().mockResolvedValue("run-id"),
}));

const recordAuditMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({ recordAudit: recordAuditMock }));

// Mocked wholesale (not just renderToBuffer): the real component calls
// StyleSheet.create(...) at module scope, which would throw against a
// @react-pdf/renderer mock that only provides renderToBuffer.
vi.mock("@/components/risk-profile-pdf/risk-profile-pdf-document", () => ({
  RiskProfilePdfDocument: () => null,
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: renderToBufferMock }));

import { POST } from "../route";
import { NextRequest } from "next/server";

const makeReq = () =>
  new NextRequest("http://localhost/api/clients/c1/risk/export-pdf", { method: "POST" });
const params = () => Promise.resolve({ id: "c1" });

const FACTORS = {
  runway: 0.25,
  incomeFloor: 0.12,
  retirementHorizon: 0.09,
  withdrawal: 0.15,
  buffer: 0,
};

const event = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  kind: "capacity_changed",
  beforeLevel: "moderate",
  afterLevel: "moderately_conservative",
  reason: null,
  actorUserId: null,
  occurredAt: new Date("2026-06-30T12:00:00Z"),
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  row: {
    clientId: "c1",
    householdName: "Sam & Casey Cooper",
    compositeScore: 41,
    compositeLevel: "moderately_conservative",
    bindingConstraint: "capacity",
    toleranceScore: 70,
    toleranceSource: "rtq_client",
    toleranceConfirmedAt: new Date("2026-03-04T00:00:00Z"),
    capacityScore: 41,
    environmentAdj: 0,
    environmentReason: null,
    requiredGrowthPct: null,
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    spouseToleranceScore: null,
    capacityComputedAt: new Date("2026-06-30T00:00:00Z"),
  },
  flags: {
    notEstablished: false,
    reviewDue: false,
    capacityConstrained: true,
    goalsOverReaching: false,
    capacityPending: false,
  },
  events: [event()],
  unreviewedNotes: [],
  pendingRtqs: [],
  contacts: { primary: null, spouse: null },
  ...over,
});

describe("POST /api/clients/[id]/risk/export-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    renderToBufferMock.mockResolvedValue(Buffer.from("%PDF-1.7 test"));
    rateLimitMocks.checkExportPdfRateLimit.mockResolvedValue({ allowed: true });
    requireClientAccessMock.mockResolvedValue({
      client: { id: "c1", crmHouseholdId: "hh-1", advisorId: "adv-99" },
      firmId: "firm_test",
    });
    capacityMock.mockImplementation(async () => {
      order.push("capacity");
      return { capacityScore: 41, requiredGrowthPct: 12, factors: FACTORS };
    });
    detailMock.mockImplementation(async () => {
      order.push("detail");
      return detail();
    });
    resolveActorsMock.mockResolvedValue(new Map());
    savePlanToVaultMock.mockResolvedValue({ id: "doc-1" });
  });

  it("returns a PDF attachment named for the household", async () => {
    const res = await POST(makeReq(), { params: params() });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(
      "risk-profile-sam-casey-cooper-",
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "risk_profile.export_pdf", clientId: "c1" }),
    );
  });

  it("reads the profile AFTER computing capacity, so the row reflects the recompute", async () => {
    await POST(makeReq(), { params: params() });
    expect(order).toEqual(["capacity", "detail"]);
  });

  it("renders the planless household with no factors instead of failing", async () => {
    capacityMock.mockRejectedValue(new Error("no base scenario"));

    const res = await POST(makeReq(), { params: params() });

    expect(res.status).toBe(200);
    expect(renderToBufferMock.mock.calls[0][0].props.factors).toBeNull();
  });

  it("labels an unattributed RTQ as the client and an unattributed recompute as the system", async () => {
    detailMock.mockResolvedValue(
      detail({
        events: [
          event({ id: "e1", kind: "capacity_changed", actorUserId: null }),
          event({ id: "e2", kind: "rtq_completed", actorUserId: null, beforeLevel: null }),
        ],
      }),
    );

    await POST(makeReq(), { params: params() });

    const lines = renderToBufferMock.mock.calls[0][0].props.events;
    expect(lines.map((l: { actor: string }) => l.actor)).toEqual(["System", "Client"]);
    expect(lines[0].date).toBe("2026-06-30");
    expect(lines[0].summary).toBe(
      "Planning change moved the profile from Moderate to Moderately Conservative",
    );
  });

  it("names the advisor who made a change, and degrades to Former member when the lookup misses", async () => {
    detailMock.mockResolvedValue(
      detail({
        events: [
          event({ id: "e1", kind: "tolerance_manual", actorUserId: "user_here", reason: "call" }),
          event({ id: "e2", kind: "tolerance_manual", actorUserId: "user_gone" }),
        ],
      }),
    );
    resolveActorsMock.mockResolvedValue(new Map([["user_here", { name: "Dana Reyes" }]]));

    await POST(makeReq(), { params: params() });

    const lines = renderToBufferMock.mock.calls[0][0].props.events;
    expect(lines.map((l: { actor: string }) => l.actor)).toEqual(["Dana Reyes", "Former member"]);
    // Only the two distinct attributed ids reach Clerk — nulls are filtered out.
    expect(resolveActorsMock).toHaveBeenCalledWith(["user_here", "user_gone"]);
  });

  it("refuses the export when the firm is over its PDF rate limit", async () => {
    rateLimitMocks.checkExportPdfRateLimit.mockResolvedValue({ allowed: false });
    rateLimitMocks.rateLimitErrorResponse.mockReturnValue(
      new Response(null, { status: 429 }),
    );

    const res = await POST(makeReq(), { params: params() });

    expect(res.status).toBe(429);
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });

  it("files the export in the vault as a risk_profile plan", async () => {
    await POST(makeReq(), { params: params() });
    expect(savePlanToVaultMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", firmId: "firm_test", reportType: "risk_profile" }),
    );
  });
});
