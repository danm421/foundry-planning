import { describe, it, expect } from "vitest";
import { giftCreateSchema, giftUpdateSchema } from "../gifts";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("giftCreateSchema", () => {
  it("accepts a minimal gift to a trust", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 2_400_000,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects when more than one recipient is set", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 100,
      grantor: "client",
      recipientEntityId: UUID,
      recipientFamilyMemberId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects when no recipient is set", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 100,
      grantor: "client",
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects amount ≤ 0", () => {
    const r = giftCreateSchema.safeParse({
      year: 2026,
      amount: 0,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects year out of plausible range", () => {
    const r = giftCreateSchema.safeParse({
      year: 1800,
      amount: 100,
      grantor: "client",
      recipientEntityId: UUID,
      useCrummeyPowers: false,
    });
    expect(r.success).toBe(false);
  });
});

describe("giftUpdateSchema", () => {
  it("accepts a partial update of amount only", () => {
    const r = giftUpdateSchema.safeParse({ amount: 50_000 });
    expect(r.success).toBe(true);
  });

  it("rejects a partial update setting two recipients at once", () => {
    const r = giftUpdateSchema.safeParse({
      recipientEntityId: UUID,
      recipientFamilyMemberId: UUID,
    });
    expect(r.success).toBe(false);
  });
});
