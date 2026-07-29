import { describe, expect, it } from "vitest";
import { planningDecisionsSchema } from "../types";

const MINIMAL = { version: 1, assumptions: {}, savings: [], socialSecurity: [], goals: [], incomeTiming: [], questions: [], notes: [] };

describe("planningDecisionsSchema", () => {
  it("accepts a minimal well-formed payload", () => {
    expect(planningDecisionsSchema.safeParse(MINIMAL).success).toBe(true);
  });

  it("requires a reason on every decision", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { retirementAge: { value: 64, provenance: "document" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a provenance outside the vocabulary", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { retirementAge: { value: 64, provenance: "vibes", reason: "x" } },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts the estimated provenance", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      assumptions: { retirementAge: { value: 64, provenance: "estimated", reason: "Model estimate." } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown root key", () => {
    expect(planningDecisionsSchema.safeParse({ ...MINIMAL, mystery: 1 }).success).toBe(false);
  });

  it("caps oversize lists", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      savings: Array.from({ length: 201 }, () => ({ accountName: "a", owner: "client" })),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a year ref outside YEAR_REFS", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      incomeTiming: [{ incomeName: "Salary", endYearRef: { value: "someday", provenance: "document", reason: "x" } }],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a year ref inside YEAR_REFS", () => {
    const parsed = planningDecisionsSchema.safeParse({
      ...MINIMAL,
      incomeTiming: [{ incomeName: "Salary", endYearRef: { value: "client_retirement", provenance: "document", reason: "x" } }],
    });
    expect(parsed.success).toBe(true);
  });
});
