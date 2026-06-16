// src/app/api/cron/reconcile-billing/__tests__/route-autoheal.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFirms = vi.fn();
const mockSelectSubs = vi.fn();
const mockSelectItems = vi.fn();
const mockReconcileInsert = vi.fn();
const mockReconcileUpdate = vi.fn();

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
      insert: () => ({ values: () => ({ returning: () => mockReconcileInsert() }) }),
      update: () => ({ set: (v: unknown) => ({ where: () => mockReconcileUpdate(v) }) }),
    },
  };
});

const mockSubsRetrieve = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({ subscriptions: { retrieve: (...a: unknown[]) => mockSubsRetrieve(...a) } }),
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

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockRecordAudit(...a) }));

// webhook-error helper short-circuits to 0 (no DB count needed here).
vi.mock("@/lib/billing/webhook-error-check", () => ({
  checkRecentWebhookErrors: vi.fn().mockResolvedValue(0),
}));

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
  mockRecordAudit.mockReset();
  process.env.CRON_SECRET = "secret_t";
  mockReconcileInsert.mockResolvedValue([{ id: "run_1" }]);
});

const authed = () =>
  new Request("http://localhost/api/cron/reconcile-billing", {
    headers: { authorization: "Bearer secret_t" },
  }) as never;

describe("reconcile-billing auto-heal", () => {
  it("writes Stripe's status back to Clerk and audits the heal on status drift", async () => {
    mockSelectFirms.mockResolvedValue([{ firmId: "org_1", isFounder: false, archivedAt: null }]);
    mockSelectSubs.mockResolvedValue([
      { id: "sub-uuid", firmId: "org_1", stripeSubscriptionId: "sub_1", status: "active" },
    ]);
    mockSelectItems.mockResolvedValue([{ kind: "seat", addonKey: null, quantity: 1, removedAt: null }]);
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      items: { data: [{ id: "si_seat", quantity: 1, metadata: { kind: "seat" } }] },
    });
    // Clerk says "trialing" but Stripe says "active" → status drift only (the
    // seat-bundled ai_copilot + ai_import already match), heal status to active.
    mockGetOrg.mockResolvedValue({
      publicMetadata: {
        subscription_status: "trialing",
        entitlements: ["ai_copilot", "ai_import"],
      },
    });

    const res = await GET(authed());
    expect(res.status).toBe(200);

    expect(mockUpdateOrgMeta).toHaveBeenCalledWith(
      "org_1",
      { publicMetadata: { subscription_status: "active" } },
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.reconcile_healed",
        firmId: "org_1",
        metadata: expect.objectContaining({ healedFields: ["status"] }),
      }),
    );
  });

  it("does not heal (or audit) when there is no drift", async () => {
    mockSelectFirms.mockResolvedValue([{ firmId: "org_1", isFounder: false, archivedAt: null }]);
    mockSelectSubs.mockResolvedValue([
      { id: "sub-uuid", firmId: "org_1", stripeSubscriptionId: "sub_1", status: "active" },
    ]);
    mockSelectItems.mockResolvedValue([{ kind: "seat", addonKey: null, quantity: 1, removedAt: null }]);
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      items: { data: [{ id: "si_seat", quantity: 1, metadata: { kind: "seat" } }] },
    });
    mockGetOrg.mockResolvedValue({
      // seat item → derived entitlements = ["ai_copilot", "ai_import"] (bundled into the plan)
      publicMetadata: {
        subscription_status: "active",
        entitlements: ["ai_copilot", "ai_import"],
      },
    });

    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(mockUpdateOrgMeta).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
