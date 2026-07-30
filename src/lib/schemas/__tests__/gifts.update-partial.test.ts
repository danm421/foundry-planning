/**
 * `giftUpdateSchema` must be PARTIAL — absent keys must stay absent.
 *
 * The PATCH route writes `useCrummeyPowers` through an
 * `if (patch.useCrummeyPowers !== undefined)` guard that an injected key always
 * passes, so a notes-only edit would clear the Crummey election on an ILIT
 * funding gift — a change with real gift-tax-exclusion consequences.
 * `eventKind: "outright"` is also injected; the route ignores that key today.
 */
import { describe, it, expect } from "vitest";
import { giftCreateSchema, giftUpdateSchema } from "../gifts";

describe("giftUpdateSchema is partial", () => {
  it("parses a one-key body to exactly that one key", () => {
    const result = giftUpdateSchema.safeParse({ notes: "Annual exclusion gift" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data).toEqual({ notes: "Annual exclusion gift" });
  });

  it("does not clear the Crummey election on an unrelated edit", () => {
    const result = giftUpdateSchema.safeParse({ year: 2027 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("useCrummeyPowers");
    expect(result.data).not.toHaveProperty("eventKind");
  });

  it("parses an empty body to an empty object", () => {
    const result = giftUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("still round-trips an explicit Crummey election", () => {
    const result = giftUpdateSchema.safeParse({ useCrummeyPowers: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ useCrummeyPowers: true });
  });

  it("still refuses the create-only identity fields", () => {
    // Re-parenting or swapping the underlying account/liability would break the
    // bundling contract, so these must stay stripped.
    const result = giftUpdateSchema.safeParse({
      notes: "x",
      parentGiftId: "11111111-1111-1111-1111-111111111111",
      accountId: "22222222-2222-2222-2222-222222222222",
      liabilityId: "33333333-3333-3333-3333-333333333333",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty("parentGiftId");
    expect(result.data).not.toHaveProperty("accountId");
    expect(result.data).not.toHaveProperty("liabilityId");
    expect(Object.keys(result.data)).toHaveLength(1);
  });

  it("still validates the fields that ARE sent", () => {
    expect(giftUpdateSchema.safeParse({ amount: -5 }).success).toBe(false);
    expect(giftUpdateSchema.safeParse({ grantor: "trust" }).success).toBe(false);
    expect(giftUpdateSchema.safeParse({ eventKind: "bequest" }).success).toBe(false);
  });
});

describe("giftCreateSchema keeps its defaults", () => {
  it("still defaults useCrummeyPowers and eventKind on create", () => {
    const result = giftCreateSchema.safeParse({
      year: 2026,
      amount: 19_000,
      grantor: "client",
      recipientFamilyMemberId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.useCrummeyPowers).toBe(false);
    expect(result.data.eventKind).toBe("outright");
  });
});
