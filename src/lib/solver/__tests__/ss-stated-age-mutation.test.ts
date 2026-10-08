import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { mutationKey } from "@/lib/solver/types";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationsToBaseUpdates } from "@/lib/solver/mutations-to-base-updates";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import { buildClientData } from "@/engine/__tests__/fixtures";

const m = { kind: "ss-stated-age", person: "client", age: 70, months: 0 } as const;
const CLIENT_ID = "00000000-0000-4000-8000-000000000001";

describe("ss-stated-age", () => {
  it("validates 62-70 / 0-11", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse(m).success).toBe(true);
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ ...m, age: 71 }).success).toBe(false);
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ ...m, months: 12 }).success).toBe(false);
  });

  it("has its own key", () => {
    expect(mutationKey(m)).toBe("ss-stated-age:client");
  });

  it("applies to the working SS row", () => {
    const base = buildClientData();
    expect(base.incomes.some((i) => i.type === "social_security" && i.owner === "client")).toBe(true);
    const out = applyMutations(base, [m]);
    const row = out.incomes.find((i) => i.type === "social_security" && i.owner === "client")!;
    expect(row.ssStatedAge).toBe(70);
    expect(row.ssStatedAgeMonths).toBe(0);
  });

  it("lands on the SS row's base patch", () => {
    const out = mutationsToBaseUpdates(buildClientData(), [m]);
    expect(out.incomeUpdates).toEqual([
      { id: "inc-ss-john", set: { ssStatedAge: 70, ssStatedAgeMonths: 0 } },
    ]);
  });

  it("appears in the scenario edit's fields with from: null", () => {
    const drafts = mutationsToScenarioChanges(buildClientData(), CLIENT_ID, [m]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "income",
      targetId: "inc-ss-john",
      payload: {
        ssStatedAge: { from: null, to: 70 },
        ssStatedAgeMonths: { from: null, to: 0 },
      },
    });
  });
});

