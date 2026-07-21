import { describe, it, expect, vi, beforeEach } from "vitest";
import { commitPlanBasics } from "../plan-basics";
import { emptyResult } from "../types";

function fakeTx() {
  const updates: Record<string, unknown>[] = [];
  const tx = {
    update: () => ({ set: (v: Record<string, unknown>) => { updates.push(v); return { where: async () => undefined }; } }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
  return { tx, updates };
}

const CTX = { clientId: "c1", scenarioId: "s1", orgId: "f1" } as never;

beforeEach(() => vi.clearAllMocks());

describe("commitPlanBasics", () => {
  it("writes the client horizon columns from stated values", async () => {
    const { tx, updates } = fakeTx();
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: 65, provenance: "stated" },
        lifeExpectancy: { value: 92, provenance: "stated" },
        spouseRetirementAge: { value: 66, provenance: "stated" },
        spouseLifeExpectancy: { value: 90, provenance: "stated" },
        currentLivingSpending: { value: null, provenance: "derived" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [],
      },
    } as never, CTX);

    expect(updates[0]).toMatchObject({
      retirementAge: 65, lifeExpectancy: 92,
      spouseRetirementAge: 66, spouseLifeExpectancy: 90,
    });
  });

  it("commits a null field as NO CHANGE rather than writing 0", async () => {
    const { tx, updates } = fakeTx();
    await commitPlanBasics(tx as never, {
      planBasics: {
        retirementAge: { value: null, provenance: "derived" },
        lifeExpectancy: { value: null, provenance: "derived" },
        currentLivingSpending: { value: null, provenance: "derived" },
        retirementLivingSpending: { value: null, provenance: "derived" },
        socialSecurity: [],
      },
    } as never, CTX);

    // Nothing to write at all — no client update issued.
    expect(updates).toHaveLength(0);
  });

  it("is a no-op when the payload carries no planBasics", async () => {
    const { tx, updates } = fakeTx();
    const res = await commitPlanBasics(tx as never, {} as never, CTX);
    expect(res).toEqual(emptyResult());
    expect(updates).toHaveLength(0);
  });
});
