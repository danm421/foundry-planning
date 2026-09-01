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
const mockCreateMembership = vi.fn();
const mockUpdateMembership = vi.fn();
// pending-signup.ts reaches Clerk through the same client, so the stash is
// exercised for real against these two — no separate module mock.
const mockGetUser = vi.fn();
const mockUpdateUserMetadata = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      createOrganization: (...a: unknown[]) => mockCreateOrg(...a),
      createOrganizationInvitation: (...a: unknown[]) => mockCreateInvite(...a),
      updateOrganizationMetadata: (...a: unknown[]) => mockUpdateOrgMeta(...a),
      createOrganizationMembership: (...a: unknown[]) =>
        mockCreateMembership(...a),
      updateOrganizationMembership: (...a: unknown[]) =>
        mockUpdateMembership(...a),
    },
    users: {
      getUser: (...a: unknown[]) => mockGetUser(...a),
      updateUserMetadata: (...a: unknown[]) => mockUpdateUserMetadata(...a),
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

// Override-aware write paths now consult manual entitlement overrides. These are
// the non-override flow tests, so stub the lookup to "no active overrides" —
// preserving the original assertions (entitlements derived from sub items alone).
vi.mock("@/lib/ops/entitlements", () => ({
  getActiveEntitlementOverrides: () => Promise.resolve([]),
}));

import { handleCheckoutSessionCompleted } from "../checkout-session-completed";

beforeEach(() => {
  mockSessionsRetrieve.mockReset();
  mockSubsRetrieve.mockReset();
  mockSubsUpdate.mockReset();
  mockCreateOrg.mockReset();
  mockCreateInvite.mockReset();
  mockUpdateOrgMeta.mockReset();
  mockCreateMembership.mockReset();
  mockUpdateMembership.mockReset();
  mockGetUser.mockReset();
  mockUpdateUserMetadata.mockReset();
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

function evt() {
  return {
    id: "evt_1",
    data: { object: { id: "cs_test_123" } },
  } as unknown as import("stripe").Stripe.Event;
}

describe("profile-first path (session carries client_reference_id)", () => {
  beforeEach(() => {
    mockSessionsRetrieve.mockResolvedValue({
      id: "cs_test_123",
      client_reference_id: "user_buyer",
      customer: "cus_1",
      subscription: "sub_1",
      customer_details: { email: "typo@elsewhere.example" },
      custom_fields: [],
    });
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_1",
      status: "trialing",
      trial_start: 1,
      trial_end: 2,
      cancel_at_period_end: false,
      items: { data: [] },
    });
    mockCreateOrg.mockResolvedValue({ id: "org_new" });
    mockGetUser.mockResolvedValue({
      privateMetadata: {
        pending_signup: {
          firmName: "Acme Wealth",
          advisorName: "Dana Reed",
          plan: "annual",
          primaryColor: "#0f7d6c",
          logoUrl: "https://blob.example/logo.png",
          updatedAt: "2026-08-31T00:00:00.000Z",
        },
      },
    });
    mockSubsInsert.mockResolvedValue([{ id: "internal_1" }]);
    mockFirmInsert.mockResolvedValue([{ firmId: "org_new" }]);
    mockTosInsert.mockResolvedValue([{ id: "tos_1" }]);
  });

  it("creates the org owned by the buyer, so no invitation is needed", async () => {
    await handleCheckoutSessionCompleted(evt());
    expect(mockCreateOrg).toHaveBeenCalledWith({
      name: "Acme Wealth",
      createdBy: "user_buyer",
    });
  });

  it("sends NO invitation email — this is the whole point of the change", async () => {
    await handleCheckoutSessionCompleted(evt());
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it("names the firm from OUR form, not from whatever Stripe collected", async () => {
    await handleCheckoutSessionCompleted(evt());
    expect(mockFirmInsert).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Acme Wealth", isFounder: false }),
    );
  });

  it("carries the branding the buyer chose onto the firm", async () => {
    await handleCheckoutSessionCompleted(evt());
    expect(mockFirmInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://blob.example/logo.png",
        primaryColor: "#0f7d6c",
      }),
    );
  });

  it("records ToS against the real Clerk user, not a stripe: placeholder", async () => {
    // We finally know who they are; the placeholder existed only because the
    // old flow had no user at this point.
    await handleCheckoutSessionCompleted(evt());
    expect(mockTosInsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_buyer", firmId: "org_new" }),
    );
  });

  it("clears the stash once the firm exists", async () => {
    await handleCheckoutSessionCompleted(evt());
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("user_buyer", {
      privateMetadata: {},
    });
  });

  it("still provisions when the stash is gone, falling back to a safe name", async () => {
    // A redelivery after the stash was cleared, or a user who cleared it some
    // other way, must still get a working firm — never a thrown webhook.
    mockGetUser.mockResolvedValue({ privateMetadata: {} });
    await handleCheckoutSessionCompleted(evt());
    expect(mockCreateOrg).toHaveBeenCalledWith({
      name: "Unnamed Firm",
      createdBy: "user_buyer",
    });
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it("is idempotent — a redelivery mints no second org and no invitation", async () => {
    mockSubLookup.mockResolvedValue([{ firmId: "org_existing" }]);
    await handleCheckoutSessionCompleted(evt());
    expect(mockCreateOrg).not.toHaveBeenCalled();
    expect(mockCreateInvite).not.toHaveBeenCalled();
  });

  it("tolerates an already-a-member error when ensuring the membership", async () => {
    // Clerk throws if the user is already in the org — which is the normal case
    // after createdBy. That must not fail the webhook.
    mockCreateMembership.mockRejectedValue(new Error("already a member"));
    await expect(handleCheckoutSessionCompleted(evt())).resolves.toBeUndefined();
  });

  it("pins the buyer to org:admin even when they are already a member", async () => {
    // The live dev Clerk instance has creatorRole = org:owner, so `createdBy`
    // leaves the buyer as org:owner — a role authz.ts retired, and which
    // requireOrgAdminOrOwner() 403s on (firm config, team invites, CMA edits).
    // createOrganizationMembership then throws "already a member" and cannot
    // fix it, so the role must be pinned explicitly afterwards.
    mockCreateMembership.mockRejectedValue(new Error("already a member"));
    await handleCheckoutSessionCompleted(evt());
    expect(mockUpdateMembership).toHaveBeenCalledWith({
      organizationId: "org_new",
      userId: "user_buyer",
      role: "org:admin",
    });
  });

  it("survives a Clerk failure while pinning the role", async () => {
    // Best-effort: a hiccup here must not fail an otherwise-good provision.
    mockUpdateMembership.mockRejectedValue(new Error("clerk 500"));
    await expect(handleCheckoutSessionCompleted(evt())).resolves.toBeUndefined();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "org_new" }),
    );
  });
});

describe("sales path (no client_reference_id) — unchanged", () => {
  it("still creates the org from the Stripe custom field and emails an invitation", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      id: "cs_test_456",
      customer: "cus_2",
      subscription: "sub_2",
      customer_details: { email: "buyer@firm.example" },
      custom_fields: [{ key: "firm_name", text: { value: "Runbook Firm" } }],
    });
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_2",
      status: "trialing",
      trial_start: 1,
      trial_end: 2,
      cancel_at_period_end: false,
      items: { data: [] },
    });
    mockCreateOrg.mockResolvedValue({ id: "org_sales" });
    mockSubsInsert.mockResolvedValue([{ id: "internal_2" }]);
    mockFirmInsert.mockResolvedValue([{ firmId: "org_sales" }]);
    mockTosInsert.mockResolvedValue([{ id: "tos_2" }]);

    await handleCheckoutSessionCompleted(evt());

    expect(mockCreateOrg).toHaveBeenCalledWith({ name: "Runbook Firm" });
    expect(mockCreateInvite).toHaveBeenCalledWith({
      organizationId: "org_sales",
      emailAddress: "buyer@firm.example",
      role: "org:admin",
    });
    expect(mockTosInsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "stripe:cus_2" }),
    );
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("touches no membership call at all — the invitation is the only way in", async () => {
    mockSessionsRetrieve.mockResolvedValue({
      id: "cs_test_456",
      customer: "cus_2",
      subscription: "sub_2",
      customer_details: { email: "buyer@firm.example" },
      custom_fields: [{ key: "firm_name", text: { value: "Runbook Firm" } }],
    });
    mockSubsRetrieve.mockResolvedValue({
      id: "sub_2",
      status: "trialing",
      trial_start: 1,
      trial_end: 2,
      cancel_at_period_end: false,
      items: { data: [] },
    });
    mockCreateOrg.mockResolvedValue({ id: "org_sales" });
    mockSubsInsert.mockResolvedValue([{ id: "internal_2" }]);
    mockFirmInsert.mockResolvedValue([{ firmId: "org_sales" }]);
    mockTosInsert.mockResolvedValue([{ id: "tos_2" }]);

    await handleCheckoutSessionCompleted(evt());

    expect(mockCreateMembership).not.toHaveBeenCalled();
    expect(mockUpdateMembership).not.toHaveBeenCalled();
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
    expect(mockFirmInsert).toHaveBeenCalledWith(
      expect.objectContaining({ logoUrl: null, primaryColor: null }),
    );
  });
});
