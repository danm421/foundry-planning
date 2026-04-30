import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFirms = vi.fn();
const mockSelectSubs = vi.fn();
const mockSelectItems = vi.fn();
const mockReconcileInsert = vi.fn();
const mockReconcileUpdate = vi.fn();

vi.mock("@/db/schema", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  return mod;
});

vi.mock("@/db", async () => {
  const schema = (await import("@/db/schema")) as Record<string, unknown>;
  return {
    db: {
      select: () => ({
        from: (tbl: unknown) => ({
          where: () => {
            if (tbl === schema.firms) return mockSelectFirms();
            if (tbl === schema.subscriptions) return mockSelectSubs();
            if (tbl === schema.subscriptionItems) return mockSelectItems();
            return [];
          },
        }),
      }),
      insert: () => ({
        values: (v: unknown) => ({
          returning: () => mockReconcileInsert(v),
        }),
      }),
      update: () => ({
        set: (v: unknown) => ({ where: () => mockReconcileUpdate(v) }),
      }),
    },
  };
});

const mockSubsRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: (...a: unknown[]) => mockSubsRetrieve(...a) },
  }),
}));

const mockGetOrg = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: { getOrganization: (...a: unknown[]) => mockGetOrg(...a) },
  }),
}));

const mockSentryCapture = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...a: unknown[]) => mockSentryCapture(...a),
}));

import { GET } from "../route";

beforeEach(() => {
  mockSelectFirms.mockReset();
  mockSelectSubs.mockReset();
  mockSelectItems.mockReset();
  mockReconcileInsert.mockReset();
  mockReconcileUpdate.mockReset();
  mockSubsRetrieve.mockReset();
  mockGetOrg.mockReset();
  mockSentryCapture.mockReset();
  process.env.CRON_SECRET = "secret_t";
});

function authedReq(): Request {
  return new Request("http://localhost/api/cron/reconcile-billing", {
    method: "GET",
    headers: { authorization: "Bearer secret_t" },
  });
}

describe("GET /api/cron/reconcile-billing", () => {
  it("rejects 401 without auth header", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/reconcile-billing") as never,
    );
    expect(res.status).toBe(401);
  });

  it("rejects 401 with wrong token", async () => {
    const res = await GET(
      new Request("http://localhost/api/cron/reconcile-billing", {
        headers: { authorization: "Bearer nope" },
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("ok run with no firms writes status='ok' and skips Sentry", async () => {
    mockReconcileInsert.mockResolvedValue([{ id: "run_1" }]);
    mockSelectFirms.mockResolvedValue([]);
    const res = await GET(authedReq() as never);
    expect(res.status).toBe(200);
    expect(mockReconcileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok", firmsChecked: 0 }),
    );
    expect(mockSentryCapture).not.toHaveBeenCalled();
  });

  it("drift run writes status='drift_detected' and fires Sentry", async () => {
    mockReconcileInsert.mockResolvedValue([{ id: "run_2" }]);
    mockSelectFirms.mockResolvedValue([
      { firmId: "org_1", isFounder: false, archivedAt: null },
    ]);
    mockSelectSubs.mockResolvedValue([
      {
        id: "internal-sub-uuid",
        firmId: "org_1",
        stripeSubscriptionId: "sub_1",
        status: "active",
      },
    ]);
    mockSelectItems.mockResolvedValue([
      {
        kind: "seat",
        addonKey: null,
        quantity: 3,
        removedAt: null,
      },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "past_due",
      items: {
        data: [
          { id: "si_seat", quantity: 3, metadata: { kind: "seat" } },
        ],
      },
    });
    mockGetOrg.mockResolvedValue({
      publicMetadata: { subscription_status: "active", entitlements: [] },
    });
    const res = await GET(authedReq() as never);
    expect(res.status).toBe(200);
    expect(mockSentryCapture).toHaveBeenCalledWith(
      "Billing reconciliation drift",
      expect.objectContaining({ level: "warning" }),
    );
    expect(mockReconcileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "drift_detected" }),
    );
  });
});
