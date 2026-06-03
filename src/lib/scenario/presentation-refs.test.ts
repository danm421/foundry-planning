import { describe, it, expect } from "vitest";
import {
  resolveScenarioRef,
  keyForRef,
  labelForRef,
  planScenarioBundles,
  type PlannerPage,
} from "./presentation-refs";

describe("resolveScenarioRef", () => {
  it("maps base / null / undefined to the base scenario ref", () => {
    const base = { kind: "scenario", id: "base", toggleState: {} };
    expect(resolveScenarioRef("base")).toEqual(base);
    expect(resolveScenarioRef(null)).toEqual(base);
    expect(resolveScenarioRef(undefined)).toEqual(base);
  });

  it("maps snap:<id> to a left-side snapshot ref", () => {
    expect(resolveScenarioRef("snap:abc")).toEqual({
      kind: "snapshot",
      id: "abc",
      side: "left",
    });
  });

  it("maps any other string to a live scenario ref", () => {
    expect(resolveScenarioRef("uuid-1")).toEqual({
      kind: "scenario",
      id: "uuid-1",
      toggleState: {},
    });
  });
});

describe("keyForRef", () => {
  it("produces a stable string key per ref kind", () => {
    expect(keyForRef({ kind: "scenario", id: "base", toggleState: {} })).toBe("base");
    expect(keyForRef({ kind: "scenario", id: "uuid-1", toggleState: {} })).toBe("scenario:uuid-1");
    expect(keyForRef({ kind: "snapshot", id: "abc", side: "left" })).toBe("snap:abc");
  });
});

describe("labelForRef", () => {
  const names = new Map([
    ["uuid-1", "Retire at 67"],
    ["snap-1", "Year-end snapshot"],
  ]);

  it("labels base as 'Base Case' regardless of the name map", () => {
    expect(labelForRef({ kind: "scenario", id: "base", toggleState: {} }, names)).toBe("Base Case");
  });

  it("uses the resolved name for a live scenario, falling back to the id", () => {
    expect(labelForRef({ kind: "scenario", id: "uuid-1", toggleState: {} }, names)).toBe("Retire at 67");
    expect(labelForRef({ kind: "scenario", id: "unknown", toggleState: {} }, names)).toBe("unknown");
  });

  it("uses the resolved name for a snapshot, falling back to 'Snapshot'", () => {
    expect(labelForRef({ kind: "snapshot", id: "snap-1", side: "left" }, names)).toBe("Year-end snapshot");
    expect(labelForRef({ kind: "snapshot", id: "missing", side: "left" }, names)).toBe("Snapshot");
  });
});

describe("planScenarioBundles", () => {
  const page = (over: Partial<PlannerPage>): PlannerPage => ({
    supportsScenarioOverride: true,
    scenarioOverride: undefined,
    needsMonteCarloRun: false,
    isScenarioChanges: false,
    ...over,
  });

  it("collapses a no-override deck to a single distinct bundle = top", () => {
    const plan = planScenarioBundles([page({}), page({})], null);
    expect(plan.topKey).toBe("base");
    expect([...plan.distinct.keys()]).toEqual(["base"]);
    expect(plan.pageKeys).toEqual(["base", "base"]);
  });

  it("adds a distinct bundle for an overriding page and routes that page to it", () => {
    const plan = planScenarioBundles(
      [page({}), page({ scenarioOverride: "uuid-1" })],
      "base",
    );
    expect([...plan.distinct.keys()].sort()).toEqual(["base", "scenario:uuid-1"]);
    expect(plan.pageKeys).toEqual(["base", "scenario:uuid-1"]);
  });

  it("ignores overrides on non-overridable pages (they follow top)", () => {
    const plan = planScenarioBundles(
      [page({ supportsScenarioOverride: false, scenarioOverride: "uuid-1" })],
      "uuid-2",
    );
    expect(plan.pageKeys).toEqual(["scenario:uuid-2"]);
    expect([...plan.distinct.keys()]).toEqual(["scenario:uuid-2"]);
  });

  it("flags needsMonteCarlo per distinct ref only where an MC-needing page uses it", () => {
    const plan = planScenarioBundles(
      [
        page({ needsMonteCarloRun: true }), // top, needs MC
        page({ scenarioOverride: "uuid-1" }), // override, not MC
      ],
      "base",
    );
    expect(plan.distinct.get("base")?.needsMonteCarlo).toBe(true);
    expect(plan.distinct.get("scenario:uuid-1")?.needsMonteCarlo).toBe(false);
  });

  it("dedupes the MC run when two MC-needing pages share a scenario, but splits across scenarios", () => {
    // MC page + Retirement Summary on the SAME scenario → one bundle, one run.
    // A second Retirement Summary overridden to another scenario → its own run.
    const plan = planScenarioBundles(
      [
        page({ needsMonteCarloRun: true }), // MC page, top scenario (base)
        page({ needsMonteCarloRun: true }), // Retirement Summary, top scenario (base)
        page({ needsMonteCarloRun: true, scenarioOverride: "uuid-1" }), // Retirement Summary, scenario uuid-1
      ],
      "base",
    );
    expect(plan.distinct.get("base")?.needsMonteCarlo).toBe(true);
    expect(plan.distinct.get("scenario:uuid-1")?.needsMonteCarlo).toBe(true);
    const mcCount = [...plan.distinct.values()].filter((d) => d.needsMonteCarlo).length;
    expect(mcCount).toBe(2); // base (shared by two pages) + uuid-1
  });

  it("flags needsScenarioChanges only for live (non-base, non-snapshot) refs", () => {
    const plan = planScenarioBundles(
      [
        page({ isScenarioChanges: true }), // top = base → no changes
        page({ isScenarioChanges: true, scenarioOverride: "uuid-1" }), // live → changes
        page({ isScenarioChanges: true, scenarioOverride: "snap:s1" }), // snapshot → no changes
      ],
      "base",
    );
    expect(plan.distinct.get("base")?.needsScenarioChanges).toBe(false);
    expect(plan.distinct.get("scenario:uuid-1")?.needsScenarioChanges).toBe(true);
    expect(plan.distinct.get("snap:s1")?.needsScenarioChanges).toBe(false);
  });
});
