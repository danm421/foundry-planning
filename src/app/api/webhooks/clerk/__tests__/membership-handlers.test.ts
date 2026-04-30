import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelectFromCalls: unknown[] = [];
const mockSelectFirms = vi.fn();
const mockSelectSubs = vi.fn();
const mockTosInsert = vi.fn();

vi.mock("@/db/schema", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  return mod;
});

vi.mock("@/db", async (orig) => {
  const schema = (await import("@/db/schema")) as Record<string, unknown>;
  return {
    ...((await orig()) as object),
    db: {
      select: () => ({
        from: (tbl: unknown) => {
          mockSelectFromCalls.push(tbl);
          return {
            where: () => {
              if (tbl === schema.firms) return mockSelectFirms();
              if (tbl === schema.subscriptions) return mockSelectSubs();
              return [];
            },
          };
        },
      }),
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoNothing: () => ({
            returning: () => mockTosInsert(v),
          }),
        }),
      }),
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

const mockRecordAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (a: unknown) => mockRecordAudit(a),
}));

import { dispatchClerkMembership } from "../membership-handlers";

beforeEach(() => {
  mockSelectFromCalls.length = 0;
  mockSelectFirms.mockReset();
  mockSelectSubs.mockReset();
  mockSubsRetrieve.mockReset();
  mockSubsUpdate.mockReset();
  mockRecordAudit.mockReset();
  mockTosInsert.mockReset();
});

describe("organizationMembership.created", () => {
  it("returns null on completely unknown event type", async () => {
    const res = await dispatchClerkMembership({
      type: "totally.unknown",
      data: {},
    } as never);
    expect(res).toBeNull();
  });

  it("returns 400 when org or user id missing", async () => {
    const res = await dispatchClerkMembership({
      type: "organizationMembership.created",
      data: { organization: {} },
    } as never);
    expect(res?.status).toBe(400);
  });

  it("founder org no-ops Stripe but still audits member.invited", async () => {
    mockSelectFirms.mockResolvedValue([
      { firmId: "org_founder", isFounder: true },
    ]);
    const res = await dispatchClerkMembership({
      type: "organizationMembership.created",
      data: {
        organization: { id: "org_founder" },
        public_user_data: { user_id: "user_x" },
      },
    } as never);
    expect(res?.status).toBe(200);
    expect(mockSubsRetrieve).not.toHaveBeenCalled();
    expect(mockSubsUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.invited",
        firmId: "org_founder",
      }),
    );
  });

  it("non-founder org bumps Stripe seat quantity by 1", async () => {
    mockSelectFirms.mockResolvedValue([
      { firmId: "org_paid", isFounder: false },
    ]);
    mockSelectSubs.mockResolvedValue([
      { stripeSubscriptionId: "sub_1", status: "active" },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      items: {
        data: [
          { id: "si_seat", metadata: { kind: "seat" }, quantity: 2 },
        ],
      },
    });

    const res = await dispatchClerkMembership({
      type: "organizationMembership.created",
      data: {
        organization: { id: "org_paid" },
        public_user_data: { user_id: "user_y" },
      },
    } as never);
    expect(res?.status).toBe(200);
    expect(mockSubsUpdate).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        items: [{ id: "si_seat", quantity: 3 }],
        proration_behavior: "create_prorations",
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.invited",
        firmId: "org_paid",
      }),
    );
  });

  it("non-founder org with no live subscription audits but skips Stripe update", async () => {
    mockSelectFirms.mockResolvedValue([
      { firmId: "org_paid", isFounder: false },
    ]);
    mockSelectSubs.mockResolvedValue([
      { stripeSubscriptionId: "sub_old", status: "canceled" },
    ]);
    const res = await dispatchClerkMembership({
      type: "organizationMembership.created",
      data: {
        organization: { id: "org_paid" },
        public_user_data: { user_id: "user_y" },
      },
    } as never);
    expect(res?.status).toBe(200);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "member.invited" }),
    );
  });
});

describe("organizationMembership.deleted", () => {
  it("decreases seat quantity by 1 and audits member.removed", async () => {
    mockSelectFirms.mockResolvedValue([
      { firmId: "org_paid", isFounder: false },
    ]);
    mockSelectSubs.mockResolvedValue([
      { stripeSubscriptionId: "sub_1", status: "active" },
    ]);
    mockSubsRetrieve.mockResolvedValue({
      items: {
        data: [
          { id: "si_seat", metadata: { kind: "seat" }, quantity: 4 },
        ],
      },
    });

    await dispatchClerkMembership({
      type: "organizationMembership.deleted",
      data: {
        organization: { id: "org_paid" },
        public_user_data: { user_id: "user_z" },
      },
    } as never);
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
    await dispatchClerkMembership({
      type: "organizationMembership.updated",
      data: {
        organization: { id: "org_paid" },
        public_user_data: { user_id: "user_z" },
        role: "org:admin",
        previous_attributes: { role: "org:member" },
      },
    } as never);
    expect(mockSubsUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "member.role_changed",
        metadata: expect.objectContaining({
          from: "org:member",
          to: "org:admin",
        }),
      }),
    );
  });

  it("ignores updated event when role unchanged", async () => {
    await dispatchClerkMembership({
      type: "organizationMembership.updated",
      data: {
        organization: { id: "org_paid" },
        public_user_data: { user_id: "user_z" },
        role: "org:member",
        previous_attributes: {},
      },
    } as never);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe("user.created", () => {
  it("writes a tos_acceptances row with acceptance_source clerk_signup when legal_consent is present", async () => {
    mockTosInsert.mockResolvedValue([]);
    await dispatchClerkMembership({
      type: "user.created",
      data: {
        id: "user_signup",
        legal_consent: {
          tos_accepted_at: "2026-04-30T15:00:00Z",
          tos_version: "v1",
        },
      },
    } as never);
    expect(mockTosInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_signup",
        tosVersion: "v1",
        acceptanceSource: "clerk_signup",
      }),
    );
  });

  it("ignores user.created when legal_consent is absent", async () => {
    mockTosInsert.mockResolvedValue([]);
    await dispatchClerkMembership({
      type: "user.created",
      data: { id: "user_no_consent" },
    } as never);
    expect(mockTosInsert).not.toHaveBeenCalled();
  });
});
