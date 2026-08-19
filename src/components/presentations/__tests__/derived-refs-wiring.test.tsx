import { describe, it, expect, vi } from "vitest";
import { derivedKey } from "@/lib/presentations/derived-refs";
import { resolveDerivedBundles } from "../render-presentation-pdf";
import type { PageScenarioBundle } from "../document";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";

const tree = (tag: string): ClientData => ({ tag }) as unknown as ClientData;
const proj = (tag: string): ProjectionResult => ({ tag }) as unknown as ProjectionResult;

describe("resolveDerivedBundles", () => {
  // The real bundle store is a plain object keyed by `keyForRef`, not a Map.
  const loaded: Record<string, PageScenarioBundle> = {
    base: { clientData: tree("base"), projection: proj("base"), scenarioLabel: "Base Case" },
  };

  const pages = [
    {
      pageId: "earlyYearsLadder",
      options: {},
      requiredDerivedRefs: () => [
        { key: "up3", from: "base", label: "+3%", mutations: [] },
      ],
    },
  ];

  it("adds one bundle per requested variant under its namespaced key", () => {
    const out = resolveDerivedBundles(pages, loaded, {
      applyMutations: () => tree("mutated"),
      runProjection: () => proj("mutated"),
    });
    expect(out[derivedKey("earlyYearsLadder", "up3")]).toEqual({
      clientData: tree("mutated"),
      projection: proj("mutated"),
      scenarioLabel: "+3%",
    });
  });

  it("leaves the loaded scenario bundles untouched", () => {
    const out = resolveDerivedBundles(pages, loaded, {
      applyMutations: () => tree("mutated"),
      runProjection: () => proj("mutated"),
    });
    // Same object identity: the max-spend pass mutates bundles in place, so a
    // clone here would silently drop `maxSpend` from the rendered deck.
    expect(out.base).toBe(loaded.base);
    // And the input record itself is not written to.
    expect(Object.keys(loaded)).toEqual(["base"]);
  });

  it("derives from the named ref, not always from base", () => {
    const applyMutations = vi.fn().mockReturnValue(tree("mutated"));
    const withScenario: Record<string, PageScenarioBundle> = {
      ...loaded,
      "scenario:s1": {
        clientData: tree("s1"),
        projection: proj("s1"),
        scenarioLabel: "Roth",
      },
    };
    resolveDerivedBundles(
      [
        {
          ...pages[0],
          requiredDerivedRefs: () => [
            { key: "up3", from: "s1", label: "+3%", mutations: [] },
          ],
        },
      ],
      withScenario,
      { applyMutations, runProjection: () => proj("x") },
    );
    expect(applyMutations).toHaveBeenCalledWith(tree("s1"), []);
  });

  it("skips a variant whose source ref was never loaded rather than throwing", () => {
    const applyMutations = vi.fn().mockReturnValue(tree("m"));
    const runProjection = vi.fn().mockReturnValue(proj("m"));
    const out = resolveDerivedBundles(
      [
        {
          ...pages[0],
          requiredDerivedRefs: () => [
            { key: "up3", from: "missing", label: "+3%", mutations: [] },
          ],
        },
      ],
      loaded,
      { applyMutations, runProjection },
    );
    expect(derivedKey("earlyYearsLadder", "up3") in out).toBe(false);
    // The skip happens before any work — not after a projection we then discard.
    expect(applyMutations).not.toHaveBeenCalled();
    expect(runProjection).not.toHaveBeenCalled();
    // …and the loaded bundles still came through, so "skipped" is not "bailed".
    expect(out.base).toBe(loaded.base);
  });
});
