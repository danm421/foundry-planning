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

// Every ltc_event write is a WHOLE event: an add (the writer upserts it) or a
// remove — the writer refuses an ltc_event edit. One event per scenario.
describe("stress-ltc scenario drafts", () => {
  const changed: LtcEvent = {
    ...event,
    name: "Long-term care — John 85–88",
    people: [{ ...event.people[0], years: 4 }],
  };
  const other: LtcEvent = { ...event, id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f99887766" };
  const draftsFor = (ltcEvents: LtcEvent[], value: LtcEvent | null) =>
    mutationsToScenarioChanges(buildClientData({ ltcEvents }), "c1", [{ kind: "stress-ltc", value }]);

  it("no saved event: adds the whole event", () => {
    expect(draftsFor([], event)).toEqual([
      { opType: "add", targetKind: "ltc_event", targetId: event.id, payload: event, orderIndex: 0 },
    ]);
  });
  it("the saved event changed: re-adds the whole event, never an edit", () => {
    expect(draftsFor([event], changed)).toEqual([
      { opType: "add", targetKind: "ltc_event", targetId: event.id, payload: changed, orderIndex: 0 },
    ]);
  });
  it("a different id: removes the saved event, then adds the new one", () => {
    expect(draftsFor([event], other)).toEqual([
      { opType: "remove", targetKind: "ltc_event", targetId: event.id, payload: null, orderIndex: 0 },
      { opType: "add", targetKind: "ltc_event", targetId: other.id, payload: other, orderIndex: 1 },
    ]);
  });
  it("cleared: removes the saved event", () => {
    expect(draftsFor([event], null)).toEqual([
      { opType: "remove", targetKind: "ltc_event", targetId: event.id, payload: null, orderIndex: 0 },
    ]);
  });
  it("cleared with no saved event: nothing", () => {
    expect(draftsFor([], null)).toEqual([]);
  });
  it("identical to the saved event: nothing", () => {
    expect(draftsFor([event], structuredClone(event))).toEqual([]);
  });
});
