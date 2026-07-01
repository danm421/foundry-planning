// src/lib/solver/__tests__/comparison-bundles.test.ts
import { describe, it, expect } from "vitest";
import { keyForRef, resolveScenarioRef } from "@/lib/scenario/presentation-refs";
import { comparisonBundlesByRef, WORKING_SCENARIO_ID } from "../comparison-bundles";
import type { PageScenarioBundle } from "@/components/presentations/document";
import type { ClientData, ProjectionResult } from "@/engine";

const stub = (label: string): PageScenarioBundle => ({
  clientData: {} as ClientData,
  projection: { years: [] } as unknown as ProjectionResult,
  scenarioLabel: label,
});

describe("comparisonBundlesByRef", () => {
  it("keys base under 'base' and the working tree under 'scenario:working'", () => {
    const base = stub("Base Case");
    const working = stub("Proposed");
    const byRef = comparisonBundlesByRef(base, working);
    expect(Object.keys(byRef).sort()).toEqual(["base", "scenario:working"]);
    expect(byRef["base"]).toBe(base);
    expect(byRef["scenario:working"]).toBe(working);
  });

  it("matches the key the comparison builders resolve for the working scenario", () => {
    // The builders look up byRef[keyForRef(resolveScenarioRef(options.scenarioId))].
    expect(keyForRef(resolveScenarioRef(WORKING_SCENARIO_ID))).toBe("scenario:working");
    expect(keyForRef(resolveScenarioRef("base"))).toBe("base");
  });
});
