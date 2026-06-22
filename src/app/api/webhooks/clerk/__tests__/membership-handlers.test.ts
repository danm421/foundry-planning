import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFirms = vi.fn();
const mockSelectSubs = vi.fn();
const mockTosInsert = vi.fn();
const mockClerkEventInsert = vi.fn(); // returning() result drives svix dedup

vi.mock("@/db", async (orig) => {
  const schema = (await import("@/db/schema")) as Record<string, unknown>;
  return {
    ...((await orig()) as object),
    db: {
      select: () => ({
        from: (tbl: unknown) => ({
          where: () => {
            if (tbl === schema.firms) return mockSelectFirms();
            if (tbl === schema.subscriptions) return mockSelectSubs();
            return [];
          },
        }),
      }),
      insert: (tbl: unknown) => ({
        values: (v: unknown) => ({
          onConflictDoNothing: () => ({
            returning: () => {
              const schemaMod = schema;
              if (tbl === schemaMod.clerkEvents) return mockClerkEventInsert(v);
              return mockTosInsert(v);
            },
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => undefined }) }),
    },
  };
});

const mockSubsRetrieve = vi.fn();
const mockSubsUpdate = vi.fn();
vi.mock("@/lib/billing/stripe-client", () => ({
  getStripe: () => ({
    subscriptions: {
      retrieve: (...a: unknown[]) => mockSubsRetrieve(...a),
      update: (...a: unknown[]) => mockSubsUpdate(...a),
    },
  }),
}));

const mockListMembers = vi.fn();
const mockGetOrganization = vi.fn();
const mockUpdateOrganizationMetadata = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    organizations: {
      getOrganizationMembershipList: (...a: unknown[]) => mockListMembers(...a),
      getOrganization: (...a: unknown[]) => mockGetOrganization(...a),
      updateOrganizationMetadata: (...a: unknown[]) => mockUpdateOrganizationMetadata(...a),
    },
  }),
}));

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

const mockCaptureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => mockCaptureException(...a),
}));

const mockSendWelcomeEmail = vi.fn();
vi.mock("@/lib/onboarding/welcome-email", () => ({
  sendWelcomeEmail: (a: unknown) => mockSendWelcomeEmail(a),
}));

import { dispatchClerkMembership } from "../membership-handlers";

beforeEach(() => {
  mockSelectFirms.mockReset();
  mockSelectSubs.mockReset();
  mockTosInsert.mockReset();
  mockClerkEventInsert.mockReset();
  mockSubsRetrieve.mockReset();
  mockSubsUpdate.mockReset();
  mockListMembers.mockReset();
  mockGetOrganization.mockReset();
  mockUpdateOrganizationMetadata.mockReset();
  mockRecordAudit.mockReset();
  mockCaptureException.mockReset();
  // Default: fresh svix delivery (insert returns a row).
  mockClerkEventInsert.mockResolvedValue([{ id: "ce_1" }]);
});

describe("organizationMembership.created — absolute seat sync", () => {
  it("returns null on completely unknown event type", async () => {
    const res = await dispatchClerkMembership(
      { type: "totally.unknown", data: {} } as never,
      "svix_unknown",
    );
    expect(res).toBeNull();
  });

  it("returns 400 when org or user id missing", async () => {
    const res = await dispatchClerkMembership(
      { type: "organizationMembership.created", data: { organization: {} } } as never,
      "svix_400",
    );
    expect(res?.status).toBe(400);
  });

  it("founder org no-ops Stripe but still audits member.invited", async () => {
    mockSelectFirms.mockResolvedValue([{ firmId: "org_founder", isFounder: true }]);
    const res = await dispatchClerkMembership(
      {
        type: "organizationMembership.created",
        data: {
          organization: { id: "org_founder" },
          public_user_data: { user_id: "user_x" },
        },
      } as never,
      "svix_founder",
    );
    expect(res?.status).toBe(200);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.invited", firmId: "org_founder" }),
    );
  });

  it("sets Stripe seat quantity ABSOLUTELY to the current member count", async () => {
    mockSelectFirms.mockResolvedValue([{ firmId: "org_paid", isFounder: false }]);
    mockSelectSubs.mockResolvedValue([
      { stripeSubscriptionId: "sub_1", status: "active" },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      items: { data: [{ id: "si_seat", metadata: { kind: "seat" }, quantity: 2 }] },
    });
    // Clerk reports 4 members now — absolute quantity must be 4, NOT 2+1.
    mockListMembers.mockResolvedValue({
      data: [{}, {}, {}, {}],
      total_count: 4,
    });

    const res = await dispatchClerkMembership(
      {
        type: "organizationMembership.created",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_y" },
        },
      } as never,
      "svix_abs",
    );
    expect(res?.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        items: [{ id: "si_seat", quantity: 4 }],
        proration_behavior: "create_prorations",
      }),
    );
  });

  it("dedupes a duplicate svix delivery — no second Stripe update", async () => {
    mockClerkEventInsert.mockResolvedValue([]); // ON CONFLICT DO NOTHING → already processed
    const res = await dispatchClerkMembership(
      {
        type: "organizationMembership.created",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_y" },
        },
      } as never,
      "svix_dup",
    );
    expect(res?.status).toBe(200);
    expect(mockSelectFirms).not.toHaveBeenCalled();
    expect(mockSubsUpdate).not.toHaveBeenCalled();
  });

  it("swallows a Stripe failure: returns 200 + logs to Sentry (no retry storm)", async () => {
    mockSelectFirms.mockResolvedValue([{ firmId: "org_paid", isFounder: false }]);
    mockSelectSubs.mockResolvedValue([
      { stripeSubscriptionId: "sub_1", status: "active" },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      items: { data: [{ id: "si_seat", metadata: { kind: "seat" }, quantity: 2 }] },
    });
    mockListMembers.mockResolvedValue({ data: [{}, {}, {}], total_count: 3 });
    mockSubsUpdate.mockRejectedValue(new Error("stripe 500"));

    const res = await dispatchClerkMembership(
      {
        type: "organizationMembership.created",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_y" },
        },
      } as never,
      "svix_fail",
    );
    expect(res?.status).toBe(200);
    expect(mockCaptureException).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.invited" }),
    );
  });
});

describe("organizationMembership.deleted — absolute seat sync", () => {
  it("sets Stripe seat quantity to the now-lower member count and audits member.removed", async () => {
    mockSelectFirms.mockResolvedValue([{ firmId: "org_paid", isFounder: false }]);
    mockSelectSubs.mockResolvedValue([
      { stripeSubscriptionId: "sub_1", status: "active" },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      items: { data: [{ id: "si_seat", metadata: { kind: "seat" }, quantity: 4 }] },
    });
    mockListMembers.mockResolvedValue({ data: [{}, {}, {}], total_count: 3 });

    await dispatchClerkMembership(
      {
        type: "organizationMembership.deleted",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_z" },
        },
      } as never,
      "svix_del",
    );
    expect(mockSubsUpdate).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({ items: [{ id: "si_seat", quantity: 3 }] }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.removed" }),
    );
  });
});

describe("organizationMembership.updated", () => {
  it("audits member.role_changed when role changed; no Stripe call", async () => {
    await dispatchClerkMembership(
      {
        type: "organizationMembership.updated",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_z" },
          role: "org:admin",
          previous_attributes: { role: "org:member" },
        },
      } as never,
      "svix_role",
    );
    expect(mockSubsUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.role_changed",
        metadata: expect.objectContaining({ from: "org:member", to: "org:admin" }),
      }),
    );
  });

  it("ignores updated event when role unchanged", async () => {
    await dispatchClerkMembership(
      {
        type: "organizationMembership.updated",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_z" },
          role: "org:member",
          previous_attributes: {},
        },
      } as never,
      "svix_norole",
    );
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe("organizationMembership.created — billing contact pin", () => {
  beforeEach(() => {
    // Default: founder-free paid org so seat sync doesn't interfere.
    mockSelectFirms.mockResolvedValue([{ firmId: "org_paid", isFounder: false }]);
    mockSelectSubs.mockResolvedValue([]);
    // Clerk membership list still needed even if seat sync is a no-op (no active sub).
    mockListMembers.mockResolvedValue({ data: [], total_count: 0 });
  });

  it("pins the first admin as billing contact when none is set yet", async () => {
    mockGetOrganization.mockResolvedValue({ publicMetadata: {} });

    const res = await dispatchClerkMembership(
      {
        type: "organizationMembership.created",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_buyer" },
          role: "org:admin",
        },
      } as never,
      "svix_pin_admin",
    );
    expect(res?.status).toBe(200);
    expect(mockGetOrganization).toHaveBeenCalledWith({ organizationId: "org_paid" });
    expect(mockUpdateOrganizationMetadata).toHaveBeenCalledWith(
      "org_paid",
      expect.objectContaining({
        publicMetadata: expect.objectContaining({ billing_contact_userId: "user_buyer" }),
      }),
    );
  });

  it("does NOT overwrite an already-pinned billing contact", async () => {
    mockGetOrganization.mockResolvedValue({
      publicMetadata: { billing_contact_userId: "user_existing" },
    });

    const res = await dispatchClerkMembership(
      {
        type: "organizationMembership.created",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_buyer2" },
          role: "org:admin",
        },
      } as never,
      "svix_pin_no_overwrite",
    );
    expect(res?.status).toBe(200);
    expect(mockUpdateOrganizationMetadata).not.toHaveBeenCalled();
  });

  it("does NOT pin a non-admin member", async () => {
    const res = await dispatchClerkMembership(
      {
        type: "organizationMembership.created",
        data: {
          organization: { id: "org_paid" },
          public_user_data: { user_id: "user_member" },
          role: "org:member",
        },
      } as never,
      "svix_pin_non_admin",
    );
    expect(res?.status).toBe(200);
    expect(mockGetOrganization).not.toHaveBeenCalled();
    expect(mockUpdateOrganizationMetadata).not.toHaveBeenCalled();
  });
});

describe("user.created", () => {
  beforeEach(() => {
    mockSendWelcomeEmail.mockReset();
    mockClerkEventInsert.mockReturnValue([{ id: "evt_new" }]); // default: new delivery
  });

  it("writes a tos_acceptances row with acceptance_source clerk_signup when legal_consent is present", async () => {
    mockTosInsert.mockResolvedValue([]);
    await dispatchClerkMembership(
      {
        type: "user.created",
        data: {
          id: "user_signup",
          email_addresses: [{ id: "idn_1", email_address: "sarah@example.com" }],
          primary_email_address_id: "idn_1",
          first_name: "Sarah",
          legal_consent: { tos_accepted_at: "2026-04-30T15:00:00Z", tos_version: "v1" },
        },
      } as never,
      "svix_signup",
    );
    expect(mockTosInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_signup",
        tosVersion: "v1",
        acceptanceSource: "clerk_signup",
      }),
    );
  });

  it("does not write a tos_acceptances row when legal_consent is absent", async () => {
    mockTosInsert.mockResolvedValue([]);
    await dispatchClerkMembership(
      {
        type: "user.created",
        data: {
          id: "user_no_consent",
          email_addresses: [{ id: "idn_1", email_address: "x@example.com" }],
          primary_email_address_id: "idn_1",
        },
      } as never,
      "svix_noconsent",
    );
    expect(mockTosInsert).not.toHaveBeenCalled();
  });

  it("sends a welcome email to the primary address with the first name", async () => {
    await dispatchClerkMembership(
      {
        type: "user.created",
        data: {
          id: "user_welcome",
          first_name: "Sarah",
          email_addresses: [
            { id: "idn_other", email_address: "old@example.com" },
            { id: "idn_primary", email_address: "sarah@example.com" },
          ],
          primary_email_address_id: "idn_primary",
        },
      } as never,
      "svix_welcome",
    );
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith({
      to: "sarah@example.com",
      firstName: "Sarah",
    });
  });

  it("falls back to the first email and null first name when no primary is flagged", async () => {
    await dispatchClerkMembership(
      {
        type: "user.created",
        data: {
          id: "user_nofirst",
          email_addresses: [{ id: "idn_1", email_address: "first@example.com" }],
        },
      } as never,
      "svix_nofirst",
    );
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith({
      to: "first@example.com",
      firstName: null,
    });
  });

  it("does not send when the payload has no email address", async () => {
    await dispatchClerkMembership(
      { type: "user.created", data: { id: "user_noemail", first_name: "Sarah" } } as never,
      "svix_noemail",
    );
    expect(mockSendWelcomeEmail).not.toHaveBeenCalled();
  });

  it("skips a duplicate svix delivery — no welcome email, no tos insert", async () => {
    mockClerkEventInsert.mockReturnValue([]); // duplicate delivery
    const res = await dispatchClerkMembership(
      {
        type: "user.created",
        data: {
          id: "user_dup",
          first_name: "Sarah",
          email_addresses: [{ id: "idn_1", email_address: "sarah@example.com" }],
          primary_email_address_id: "idn_1",
          legal_consent: { tos_accepted_at: "2026-04-30T15:00:00Z", tos_version: "v1" },
        },
      } as never,
      "svix_dup",
    );
    expect(res?.status).toBe(200);
    expect(mockSendWelcomeEmail).not.toHaveBeenCalled();
    expect(mockTosInsert).not.toHaveBeenCalled();
  });
});
