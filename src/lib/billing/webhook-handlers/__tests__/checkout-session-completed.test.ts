import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSessionsRetrieve = vi.fn();
const mockSubsRetrieve = vi.fn();
const mockSubsUpdate = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    checkout: {
      sessions: { retrieve: (...a: unknown[]) => mockSessionsRetrieve(...a) },
    },
    subscriptions: {
      retrieve: (...a: unknown[]) => mockSubsRetrieve(...a),
      update: (...a: unknown[]) => mockSubsUpdate(...a),
    },
  }),
}));

const mockCreateOrg = vi.fn();
const mockCreateInvite = vi.fn();
const mockUpdateOrgMeta = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      createOrganization: (...a: unknown[]) => mockCreateOrg(...a),
      createOrganizationInvitation: (...a: unknown[]) => mockCreateInvite(...a),
      updateOrganizationMetadata: (...a: unknown[]) => mockUpdateOrgMeta(...a),
    },
  }),
}));

const mockFirmInsert = vi.fn();
const mockSubsInsert = vi.fn();
const mockItemsInsert = vi.fn();
const mockTosInsert = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: (table: { _: { name: string } } | unknown) => ({
      values: (v: unknown) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            const tname =
              typeof table === "object" && table && "_" in table
                ? (table as { _: { name?: string } })._.name
                : "";
            if (tname === "firms") return mockFirmInsert(v);
            if (tname === "subscriptions") return mockSubsInsert(v);
            if (tname === "subscription_items") return mockItemsInsert(v);
            return mockTosInsert(v);
          },
        }),
        returning: () => mockTosInsert(v),
      }),
    }),
  },
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

import { handleCheckoutSessionCompleted } from "../checkout-session-completed";

beforeEach(() => {
  mockSessionsRetrieve.mockReset();
  mockSubsRetrieve.mockReset();
  mockSubsUpdate.mockReset();
  mockCreateOrg.mockReset();
  mockCreateInvite.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockFirmInsert.mockReset();
  mockSubsInsert.mockReset();
  mockItemsInsert.mockReset();
  mockTosInsert.mockReset();
  mockRecordAudit.mockReset();
});

describe("handleCheckoutSessionCompleted", () => {
  it("creates Clerk org + invite, writes initial rows, audits", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      id: "cs_1",
      customer: "cus_1",
      subscription: "sub_1",
      customer_details: { email: "buyer@example.com" },
      consent: { terms_of_service: "accepted" },
      custom_fields: [
        { key: "firm_name", text: { value: "Acme Advisors" } },
      ],
      metadata: {},
    });
    mockCreateOrg.mockResolvedValue({ id: "org_new", name: "Acme Advisors" });
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "trialing",
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: 1700000000,
      items: {
        data: [
          {
            id: "si_seat",
            price: { id: "price_seat", unit_amount: 9900, currency: "usd" },
            quantity: 1,
            metadata: { kind: "seat" },
            current_period_start: 1690000000,
            current_period_end: 1692592000,
          },
        ],
      },
      metadata: {},
    });
    mockFirmInsert.mockResolvedValue([{ firmId: "org_new" }]);
    mockSubsInsert.mockResolvedValue([{ id: "internal-sub" }]);
    mockItemsInsert.mockResolvedValue([]);
    mockTosInsert.mockResolvedValue([]);

    await handleCheckoutSessionCompleted({
      id: "evt_co",
      type: "checkout.session.completed",
      data: { object: { id: "cs_1" } },
    } as never);

    expect(mockCreateOrg).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme Advisors" }),
    );
    expect(mockCreateInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_new",
        emailAddress: "buyer@example.com",
        role: "org:owner",
      }),
    );
    expect(mockSubsUpdate).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        metadata: expect.objectContaining({ firm_id: "org_new" }),
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.subscription_created",
        firmId: "org_new",
      }),
    );
  });
});
