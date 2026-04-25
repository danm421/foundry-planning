// src/engine/scenario/__tests__/applyChanges.test.ts
import { describe, it, expect } from "vitest";
import { resolveEffectiveToggleState } from "../applyChanges";
import type { ToggleGroup } from "../types";

describe("resolveEffectiveToggleState", () => {
  const independentGroup: ToggleGroup = {
    id: "g1",
    scenarioId: "s1",
    name: "g1",
    defaultOn: true,
    requiresGroupId: null,
    orderIndex: 0,
  };

  const childGroup: ToggleGroup = {
    id: "g2",
    scenarioId: "s1",
    name: "g2",
    defaultOn: true,
    requiresGroupId: "g1",
    orderIndex: 1,
  };

  it("returns explicit state for groups with no parent", () => {
    const result = resolveEffectiveToggleState(
      { g1: true },
      [independentGroup],
    );
    expect(result).toEqual({ g1: true });
  });

  it("falls back to defaultOn when state is missing", () => {
    const result = resolveEffectiveToggleState({}, [independentGroup]);
    expect(result).toEqual({ g1: true });
  });

  it("forces child off when parent is off", () => {
    const result = resolveEffectiveToggleState(
      { g1: false, g2: true },
      [independentGroup, childGroup],
    );
    expect(result).toEqual({ g1: false, g2: false });
  });

  it("respects child's own state when parent is on", () => {
    const result = resolveEffectiveToggleState(
      { g1: true, g2: false },
      [independentGroup, childGroup],
    );
    expect(result).toEqual({ g1: true, g2: false });
  });
});
