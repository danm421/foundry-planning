// promote_to_base approval card. The card lists the scenario's changes, and the
// scenario id comes from the model, so the card reads those changes only after
// confirming the scenario belongs to the client this conversation is about —
// the same check the promote tool itself makes before writing.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { scenarioRows } = vi.hoisted(() => ({ scenarioRows: { value: [] as unknown[] } }));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(scenarioRows.value) }),
    }),
  },
}));
vi.mock("@/lib/scenario/loader", () => ({
  loadEffectiveTree: vi.fn(async () => ({ effectiveTree: { incomes: [], expenses: [] } })),
}));
vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges: vi.fn(async () => []),
  loadScenarioToggleGroups: vi.fn(async () => []),
}));
vi.mock("@/lib/scenario/scenario-changes-to-base-writes", () => ({
  scenarioChangesToBaseWrites: vi.fn(() => ({
    inserts: [{ kind: "income", targetId: "new-1", raw: {} }],
    updates: [{ kind: "account", id: "acc-1", set: {} }],
    singletonUpdates: [],
    removes: [{ kind: "income", id: "inc-1", cascade: false }],
    // A recurring series is a `gift` change that does NOT land in `inserts`;
    // without its own preview line the confirmation would say "no field-level
    // changes" for a promote that writes one.
    giftSeries: { upserts: [{ id: "gs-1", draft: { kind: "series" } }], removes: [] },
  })),
}));

import { describeProposedWrite } from "../preview";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import type { ForgeAuthContext } from "@/domain/forge/state";

const ctx: ForgeAuthContext = {
  userId: "user_b",
  firmId: "firm_b",
  clientId: "client_b",
  scenarioId: "base",
};
const call = { name: "promote_to_base", args: { scenarioId: "s1" } } as const;

describe("promote_to_base card", () => {
  beforeEach(() => {
    vi.mocked(loadScenarioChanges).mockReset().mockResolvedValue([]);
    vi.mocked(loadScenarioToggleGroups).mockClear();
  });

  it("does not read or list the changes of a scenario outside the conversation's client", async () => {
    scenarioRows.value = [];
    const out = await describeProposedWrite(call, ctx);

    expect(loadScenarioChanges).not.toHaveBeenCalled();
    expect(loadScenarioToggleGroups).not.toHaveBeenCalled();
    expect(out.details).toBeUndefined();
  });

  it("lists one line per write, the auto-snapshot and the sibling-delete warning for the client's own scenario", async () => {
    scenarioRows.value = [{ id: "s1" }];
    const out = await describeProposedWrite(call, ctx);

    expect(loadScenarioChanges).toHaveBeenCalledWith("s1");
    const details = out.details!;
    expect(details).toEqual(
      expect.arrayContaining(["ADD income", "EDIT account acc-1", "REMOVE income inc-1"]),
    );
    expect(details.some((l) => l.includes("ADD") && /series/i.test(l))).toBe(true);
    expect(details.some((l) => /auto-snapshot/i.test(l))).toBe(true);
    expect(details.some((l) => /warning/i.test(l))).toBe(true);
  });

  it("degrades to the plain summary when a loader throws", async () => {
    scenarioRows.value = [{ id: "s1" }];
    vi.mocked(loadScenarioChanges).mockRejectedValue(new Error("DB unavailable"));
    const out = await describeProposedWrite(call, ctx);

    expect(out.summary).toBeDefined();
    expect(out.details).toBeUndefined();
  });
});
