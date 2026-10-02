import { describe, it, expect } from "vitest";
import { applyMutations } from "../apply-mutations";
import { mutationKey } from "../types";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { isBaseSavableMutation } from "../mutations-to-base-updates";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { LtcEvent } from "@/engine/types";

const event: LtcEvent = {
  id: "3f1c2d7e-8a1b-4c5d-9e0f-112233445566",
  name: "Long-term care — John 85–87",
  people: [{ person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 }],
  livingExpenseCutPct: null,
  homeSale: null,
  includePolicies: true,
};

describe("stress-ltc", () => {
  it("has one key", () => {
    expect(mutationKey({ kind: "stress-ltc", value: event })).toBe("stress-ltc");
  });
  it("parses through the wire schema", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "stress-ltc", value: event }).success).toBe(true);
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ kind: "stress-ltc", value: null }).success).toBe(true);
  });
  it("applyMutations puts the event on the tree; null clears it", () => {
    expect(applyMutations(buildClientData(), [{ kind: "stress-ltc", value: event }]).ltcEvents).toEqual([event]);
    expect(applyMutations(buildClientData({ ltcEvents: [event] }), [{ kind: "stress-ltc", value: null }]).ltcEvents).toEqual([]);
  });
  it("saves to a scenario as its OWN ltc_event add row, not a plan_settings field", () => {
    const drafts = mutationsToScenarioChanges(buildClientData(), "c1", [{ kind: "stress-ltc", value: event }]);
    expect(drafts).toContainEqual(
      expect.objectContaining({ opType: "add", targetKind: "ltc_event", targetId: event.id, payload: event }),
    );
    expect(drafts.find((d) => d.targetKind === "plan_settings")).toBeUndefined();
  });
  it("is never saved to base", () => {
    expect(isBaseSavableMutation({ kind: "stress-ltc", value: event })).toBe(false);
  });
});
