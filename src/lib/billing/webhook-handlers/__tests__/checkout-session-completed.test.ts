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
const mockSubLookup = vi.fn(); // SELECT existing sub by stripeCustomerId
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => mockSubLookup() }) }),
    insert: (table: unknown) => ({
      values: (v: unknown) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            // drizzle stores the SQL table name at runtime under this symbol;
            // `table._.name` is a TYPE-only brand and is absent at runtime
            // (so the old `"_" in table` check always fell through to tos).
            const tname =
              (table as Record<symbol, string>)[Symbol.for("drizzle:Name")] ??
              "";
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
  mockSubLookup.mockReset();
  mockSubLookup.mockResolvedValue([]); // default: brand-new firm
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
            price: {
              id: "price_seat",
              unit_amount: 9900,
              currency: "usd",
              metadata: { kind: "seat" }, // Stripe stamps kind on the PRICE
            },
            quantity: 1,
            metadata: {}, // ITEM metadata is empty in practice
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
        role: "org:admin",
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

  it("tags subscription items from price.metadata, not item metadata (entitlement-critical)", async () => {
    // Stripe stamps kind/addon_key on the PRICE metadata; the subscription
    // ITEM metadata is empty. Reading it.metadata silently mislabels the
    // AI-Import add-on as a seat (kind=seat, addonKey=null) → deriveEntitlements
    // (which filters kind==="addon" && addonKey) never grants `ai_import`.
    mockSessionsRetrieve.mockResolvedValue({
      id: "cs_addon",
      customer: "cus_addon",
      subscription: "sub_addon",
      customer_details: { email: "buyer3@example.com" },
      custom_fields: [{ key: "firm_name", text: { value: "Gamma Advisors" } }],
      metadata: {},
    });
    mockCreateOrg.mockResolvedValue({ id: "org_gamma", name: "Gamma Advisors" });
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_addon",
      customer: "cus_addon",
      status: "trialing",
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: 1700000000,
      items: {
        data: [
          {
            id: "si_seat",
            price: {
              id: "price_seat",
              unit_amount: 9900,
              currency: "usd",
              metadata: { kind: "seat" },
            },
            quantity: 1,
            metadata: {},
            current_period_start: 1690000000,
            current_period_end: 1692592000,
          },
          {
            id: "si_ai",
            price: {
              id: "price_ai_import",
              unit_amount: 19900,
              currency: "usd",
              metadata: { kind: "addon", addon_key: "ai_import" },
            },
            quantity: 1,
            metadata: {},
          },
        ],
      },
      metadata: {},
    });
    mockFirmInsert.mockResolvedValue([{ firmId: "org_gamma" }]);
    mockSubsInsert.mockResolvedValue([{ id: "internal-sub-gamma" }]);
    mockItemsInsert.mockResolvedValue([]);
    mockTosInsert.mockResolvedValue([]);

    await handleCheckoutSessionCompleted({
      id: "evt_co_addon",
      type: "checkout.session.completed",
      data: { object: { id: "cs_addon" } },
    } as never);

    expect(mockItemsInsert).toHaveBeenCalledTimes(1);
    const insertedItems = mockItemsInsert.mock.calls[0][0] as Array<{
      stripePriceId: string;
      kind: string;
      addonKey: string | null;
    }>;
    expect(insertedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stripePriceId: "price_seat",
          kind: "seat",
          addonKey: null,
        }),
        expect.objectContaining({
          stripePriceId: "price_ai_import",
          kind: "addon",
          addonKey: "ai_import",
        }),
      ]),
    );
  });

  it("writes a tos_acceptances row even when Stripe consent isn't collected", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      id: "cs_2",
      customer: "cus_2",
      subscription: "sub_2",
      customer_details: { email: "buyer2@example.com" },
      // consent intentionally omitted — we don't use Stripe's consent_collection
      custom_fields: [{ key: "firm_name", text: { value: "Beta Advisors" } }],
      metadata: {},
    });
    mockCreateOrg.mockResolvedValue({ id: "org_beta", name: "Beta Advisors" });
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_2",
      customer: "cus_2",
      status: "trialing",
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: 1700000000,
      items: { data: [] },
      metadata: {},
    });
    mockFirmInsert.mockResolvedValue([{ firmId: "org_beta" }]);
    mockSubsInsert.mockResolvedValue([{ id: "internal-sub-2" }]);
    mockItemsInsert.mockResolvedValue([]);
    mockTosInsert.mockResolvedValue([{ id: "tos-row" }]);

    await handleCheckoutSessionCompleted({
      id: "evt_co_2",
      type: "checkout.session.completed",
      data: { object: { id: "cs_2" } },
    } as never);

    expect(mockTosInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "stripe:cus_2",
        firmId: "org_beta",
        acceptanceSource: "stripe_checkout",
      }),
    );
  });

  it("converges on re-run: existing sub for the customer skips createOrganization", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      id: "cs_dup",
      customer: "cus_existing",
      subscription: "sub_existing",
      customer_details: { email: "buyer@example.com" },
      custom_fields: [{ key: "firm_name", text: { value: "Acme Advisors" } }],
      metadata: {},
    });
    // A prior (partial) run already wrote firms + subscriptions for this customer.
    mockSubLookup.mockResolvedValue([
      { firmId: "org_existing", stripeSubscriptionId: "sub_existing" },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_existing",
      customer: "cus_existing",
      status: "trialing",
      cancel_at_period_end: false,
      trial_start: null,
      trial_end: 1700000000,
      items: { data: [] },
      metadata: { firm_id: "org_existing" },
    });
    mockFirmInsert.mockResolvedValue([{ firmId: "org_existing" }]);
    mockSubsInsert.mockResolvedValue([{ id: "internal-sub" }]);
    mockItemsInsert.mockResolvedValue([]);
    mockTosInsert.mockResolvedValue([]);

    await handleCheckoutSessionCompleted({
      id: "evt_co_dup",
      type: "checkout.session.completed",
      data: { object: { id: "cs_dup" } },
    } as never);

    expect(mockCreateOrg).not.toHaveBeenCalled(); // no second Clerk org
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "org_existing" }),
    );
  });
});
