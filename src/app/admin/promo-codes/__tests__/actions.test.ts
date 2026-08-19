import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockRequireOpsAdmin = vi.fn();
const mockCreatePromoCode = vi.fn();
const mockDeactivatePromoCode = vi.fn();
const mockRecordAudit = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));
vi.mock("@/lib/ops/ops-auth", () => ({ requireOpsAdmin: () => mockRequireOpsAdmin() }));
vi.mock("@/lib/billing/promo-codes", () => ({
  createPromoCode: (...a: unknown[]) => mockCreatePromoCode(...a),
  deactivatePromoCode: (...a: unknown[]) => mockDeactivatePromoCode(...a),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockRecordAudit(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

import { createPromoCodeAction, deactivatePromoCodeAction } from "../actions";

const validForm = {
  name: "Founder 25",
  code: "FOUNDER25",
  discountKind: "percent" as const,
  percentOff: 25,
  amountOffDollars: null,
  years: 1,
  maxRedemptions: 25,
  expiresAt: null,
  firstTimeOnly: false,
  productIds: ["prod_seat_monthly", "prod_seat_annual"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user_op", orgId: "org_op" });
  mockRequireOpsAdmin.mockResolvedValue({
    clerkUserId: "user_op",
    email: "op@foundry",
    role: "superadmin",
  });
  mockCreatePromoCode.mockResolvedValue({ id: "promo_1", code: "FOUNDER25" });
  mockDeactivatePromoCode.mockResolvedValue(undefined);
});

describe("createPromoCodeAction", () => {
  it("creates, audits, revalidates, and returns the code", async () => {
    const res = await createPromoCodeAction(validForm);
    expect(res).toEqual({ ok: true, code: "FOUNDER25" });
    expect(mockCreatePromoCode).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Founder 25",
        code: "FOUNDER25",
        discount: { kind: "percent", percentOff: 25 },
        years: 1,
        maxRedemptions: 25,
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "promo_code.created", firmId: "org_op" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/promo-codes");
  });

  it("converts dollars off to cents", async () => {
    await createPromoCodeAction({
      ...validForm,
      discountKind: "amount",
      percentOff: null,
      amountOffDollars: 50,
    });
    expect(mockCreatePromoCode).toHaveBeenCalledWith(
      expect.objectContaining({ discount: { kind: "amount", amountOffCents: 5000 } }),
    );
  });

  it("rounds fractional dollars to whole cents", async () => {
    await createPromoCodeAction({
      ...validForm,
      discountKind: "amount",
      percentOff: null,
      amountOffDollars: 49.99,
    });
    expect(mockCreatePromoCode).toHaveBeenCalledWith(
      expect.objectContaining({ discount: { kind: "amount", amountOffCents: 4999 } }),
    );
  });

  it("passes an expiry date through as an end-of-day Date", async () => {
    await createPromoCodeAction({ ...validForm, expiresAt: "2027-03-01" });
    const arg = mockCreatePromoCode.mock.calls[0][0] as { expiresAt: Date };
    expect(arg.expiresAt.toISOString()).toBe("2027-03-01T23:59:59.000Z");
  });

  it("rejects a redemption cutoff in the past before calling Stripe", async () => {
    const res = await createPromoCodeAction({ ...validForm, expiresAt: "2020-01-01" });
    expect(res).toEqual({ ok: false, error: "The last day to redeem has to be in the future." });
    expect(mockCreatePromoCode).not.toHaveBeenCalled();
  });

  it("never audits a secret-free payload it did not create", async () => {
    mockCreatePromoCode.mockRejectedValue(new Error("Stripe said no"));
    const res = await createPromoCodeAction(validForm);
    expect(res).toEqual({ ok: false, error: "Stripe said no" });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload without calling Stripe", async () => {
    const res = await createPromoCodeAction({ ...validForm, name: "" });
    expect(res.ok).toBe(false);
    expect(mockCreatePromoCode).not.toHaveBeenCalled();
  });

  it("rejects a percent discount with no percent", async () => {
    const res = await createPromoCodeAction({ ...validForm, percentOff: null });
    expect(res.ok).toBe(false);
    expect(mockCreatePromoCode).not.toHaveBeenCalled();
  });

  it("rejects a dollar discount with no amount", async () => {
    const res = await createPromoCodeAction({
      ...validForm,
      discountKind: "amount",
      percentOff: null,
      amountOffDollars: null,
    });
    expect(res.ok).toBe(false);
    expect(mockCreatePromoCode).not.toHaveBeenCalled();
  });

  it("returns forbidden when the ops gate throws", async () => {
    mockRequireOpsAdmin.mockRejectedValue(new Error("nope"));
    const res = await createPromoCodeAction(validForm);
    expect(res.ok).toBe(false);
    expect(mockCreatePromoCode).not.toHaveBeenCalled();
  });
});

describe("deactivatePromoCodeAction", () => {
  it("deactivates, audits, revalidates", async () => {
    const res = await deactivatePromoCodeAction("promo_1");
    expect(res).toEqual({ ok: true });
    expect(mockDeactivatePromoCode).toHaveBeenCalledWith("promo_1");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "promo_code.deactivated", resourceId: "promo_1" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/promo-codes");
  });

  it("returns forbidden when the ops gate throws", async () => {
    mockRequireOpsAdmin.mockRejectedValue(new Error("nope"));
    const res = await deactivatePromoCodeAction("promo_1");
    expect(res.ok).toBe(false);
    expect(mockDeactivatePromoCode).not.toHaveBeenCalled();
  });

  it("surfaces a Stripe failure instead of reporting success", async () => {
    mockDeactivatePromoCode.mockRejectedValue(new Error("Stripe said no"));
    const res = await deactivatePromoCodeAction("promo_1");
    expect(res).toEqual({ ok: false, error: "Stripe said no" });
  });
});
