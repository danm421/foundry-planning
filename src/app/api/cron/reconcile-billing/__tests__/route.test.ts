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
const mockUpdateOrgMeta = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganization: (...a: unknown[]) => mockGetOrg(...a),
      updateOrganizationMetadata: (...a: unknown[]) => mockUpdateOrgMeta(...a),
    },
  }),
}));

const mockSentryCapture = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...a: unknown[]) => mockSentryCapture(...a),
}));

// Task 4.5b folded auto-heal + audit into the per-firm loop, so any drift case
// now reaches updateOrganizationMetadata + recordAudit. Mock both so the drift
// test exercises the real heal path instead of silently falling into the
// per-firm catch (which would push a spurious "<error>" drift entry).
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

// Override-aware write paths now consult manual entitlement overrides. These are
// the non-override flow tests, so stub the lookup to "no active overrides" —
// preserving the original assertions (entitlements derived from sub items alone).
vi.mock("@/lib/ops/entitlements", () => ({
  getActiveEntitlementOverrides: () => Promise.resolve([]),
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
  mockUpdateOrgMeta.mockReset();
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

  it("returns 401 when CRON_SECRET is unset even with a 'Bearer ' header", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await GET(
        new Request("http://localhost/api/cron/reconcile-billing", {
          headers: { authorization: "Bearer " },
        }) as never,
      );
      expect(res.status).toBe(401);
    } finally {
      if (prev !== undefined) process.env.CRON_SECRET = prev;
    }
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

  it("no drift when a price-tagged add-on in Stripe matches the DB mirror + Clerk", async () => {
    // Stripe stamps kind/addon_key on price.metadata (item metadata empty). If
    // the cron read it.metadata it would see the add-on as a seat and flag
    // false item + entitlement drift, paging ops on every add-on firm.
    mockReconcileInsert.mockResolvedValue([{ id: "run_ok2" }]);
    mockSelectFirms.mockResolvedValue([
      { firmId: "org_ai", isFounder: false, archivedAt: null },
    ]);
    mockSelectSubs.mockResolvedValue([
      {
        id: "internal-sub-ai",
        firmId: "org_ai",
        stripeSubscriptionId: "sub_ai",
        status: "active",
      },
    ]);
    mockSelectItems.mockResolvedValue([
      { kind: "seat", addonKey: null, quantity: 1, removedAt: null },
      { kind: "addon", addonKey: "white_label", quantity: 1, removedAt: null },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_ai",
      status: "active",
      items: {
        data: [
          {
            id: "si_seat",
            quantity: 1,
            metadata: {},
            price: { id: "price_seat", metadata: { kind: "seat" } },
          },
          {
            id: "si_addon",
            quantity: 1,
            metadata: {},
            price: {
              id: "price_white_label",
              metadata: { kind: "addon", addon_key: "white_label" },
            },
          },
        ],
      },
    });
    // Seat implies the bundled ai_copilot + ai_import; the active white_label
    // add-on grants its own entitlement. All three must be present in Clerk for
    // no drift — and because white_label is NOT seat-implied, this also proves
    // the cron classifies the add-on via price.metadata (misreading it as a seat
    // would drop white_label from the derived set and surface entitlement drift).
    mockGetOrg.mockResolvedValue({
      publicMetadata: {
        subscription_status: "active",
        entitlements: ["ai_copilot", "ai_import", "white_label"],
      },
    });

    const res = await GET(authedReq() as never);
    expect(res.status).toBe(200);
    expect(mockSentryCapture).not.toHaveBeenCalled();
    expect(mockReconcileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });
});
