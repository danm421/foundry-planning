import { describe, it, expect } from "vitest";
import { entityCreateSchema, entityUpdateSchema } from "../entities";

describe("entityCreateSchema — CRT", () => {
  const baseCrt = {
    name: "Test CRT",
    entityType: "trust" as const,
    trustSubType: "crt" as const,
    isIrrevocable: true,
    grantor: "client" as const,
    isGrantor: true,
  };
  const baseSplit = {
    origin: "new" as const,
    inceptionYear: 2026,
    inceptionValue: 1_000_000,
    payoutType: "annuity" as const,
    payoutAmount: 50_000,
    irc7520Rate: 0.04,
    termType: "years" as const,
    termYears: 10,
    charityId: "00000000-0000-0000-0000-000000000000",
  };

  it("requires splitInterest for crt subtype", () => {
    const result = entityCreateSchema.safeParse(baseCrt);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("splitInterest"))).toBe(true);
    }
  });

  it("accepts a valid CRT with splitInterest", () => {
    const result = entityCreateSchema.safeParse({ ...baseCrt, splitInterest: baseSplit });
    expect(result.success).toBe(true);
  });

  it("rejects term-certain CRT with termYears > 20", () => {
    const result = entityCreateSchema.safeParse({
      ...baseCrt,
      splitInterest: { ...baseSplit, termYears: 21 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues
        .filter((i) => i.path.join(".") === "splitInterest.termYears")
        .map((i) => i.message)
        .join(" | ");
      expect(msg).toMatch(/20 years/);
    }
  });

  it("allows term-certain CRT with termYears = 20", () => {
    const result = entityCreateSchema.safeParse({
      ...baseCrt,
      splitInterest: { ...baseSplit, termYears: 20 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects splitInterest on a non-CLT, non-CRT subtype", () => {
    const result = entityCreateSchema.safeParse({
      ...baseCrt,
      trustSubType: "ilit" as const,
      splitInterest: baseSplit,
    });
    expect(result.success).toBe(false);
  });
});
