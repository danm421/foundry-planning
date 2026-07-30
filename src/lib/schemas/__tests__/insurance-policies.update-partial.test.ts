/**
 * `insurancePolicyUpdateSchema` must be PARTIAL — absent keys must stay absent.
 *
 * The PATCH route guards every write with `input.X !== undefined`, and one of
 * those guards (`cashValueSchedule`) DELETES every schedule row before
 * re-inserting. So a defaulted key that the caller never sent is not a cosmetic
 * extra: it is a write. Zod 4's `.optional()` WRAPS a `ZodDefault` rather than
 * removing it, so building the update variant by mapping `.optional()` over the
 * create shape leaves all eleven defaults live on an absent key. The inline
 * cells on the Insurance panel send one-key bodies, which is exactly the shape
 * that gets hurt.
 */
import { describe, it, expect } from "vitest";
import {
  insurancePolicyCreateSchema,
  insurancePolicyUpdateSchema,
} from "../insurance-policies";

describe("insurancePolicyUpdateSchema is partial", () => {
  it("parses a one-key body to exactly that one key", () => {
    const result = insurancePolicyUpdateSchema.safeParse({ faceValue: 750_000 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Names the injected keys in the failure message.
    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data).toEqual({ faceValue: 750_000 });
  });

  it("does not inject the fields a cash-value edit would clobber", () => {
    const result = insurancePolicyUpdateSchema.safeParse({ cashValue: 200_000 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("costBasis");
    expect(data).not.toHaveProperty("premiumAmount");
    // The route DELETEs the whole schedule table for the policy whenever this
    // key is present, so an injected `[]` truncates a free-form policy.
    expect(data).not.toHaveProperty("cashValueSchedule");
    expect(data).not.toHaveProperty("cashValueGrowthMode");
    expect(Object.keys(data)).toHaveLength(1);
  });

  it("parses an empty body to an empty object", () => {
    const result = insurancePolicyUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("still round-trips a value the caller actually sent", () => {
    const result = insurancePolicyUpdateSchema.safeParse({
      cashValue: 0,
      premiumPayer: "spouse",
      postPayoutGrowthRate: 0.04,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      cashValue: 0,
      premiumPayer: "spouse",
      postPayoutGrowthRate: 0.04,
    });
  });

  it("still rejects a negative amount", () => {
    expect(insurancePolicyUpdateSchema.safeParse({ faceValue: -1 }).success).toBe(false);
    expect(insurancePolicyUpdateSchema.safeParse({ cashValue: -1 }).success).toBe(false);
  });

  it("still rejects a bad enum member", () => {
    expect(insurancePolicyUpdateSchema.safeParse({ premiumPayer: "nobody" }).success).toBe(false);
    expect(
      insurancePolicyUpdateSchema.safeParse({ cashValueGrowthMode: "freeform" }).success,
    ).toBe(false);
  });

  it("still accepts null on a nullable field", () => {
    const result = insurancePolicyUpdateSchema.safeParse({ premiumYears: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ premiumYears: null });
  });
});

describe("insurancePolicyCreateSchema keeps its defaults", () => {
  const validBase = {
    name: "Cooper - Term",
    policyType: "term" as const,
    insuredPerson: "client" as const,
    ownerRef: { kind: "entity" as const, id: "11111111-1111-1111-1111-111111111111" },
    faceValue: 1_000_000,
    termIssueYear: 2026,
    termLengthYears: 20,
  };

  it("applies the defaults the create path relies on", () => {
    const result = insurancePolicyCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cashValueGrowthMode).toBe("basic");
    expect(result.data.cashValueSchedule).toEqual([]);
    expect(result.data.cashValue).toBe(0);
    expect(result.data.costBasis).toBe(0);
    expect(result.data.premiumAmount).toBe(0);
    expect(result.data.premiumPayer).toBe("owner");
    expect(result.data.postPayoutGrowthRate).toBe(0.06);
  });
});
