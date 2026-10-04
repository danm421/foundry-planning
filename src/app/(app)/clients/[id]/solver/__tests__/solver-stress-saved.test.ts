import { describe, it, expect } from "vitest";
import type { ToggleGroup } from "@/engine/scenario/types";
import { switchedOffGroupNames } from "../solver-stress-saved";

const group = (id: string, defaultOn: boolean, requiresGroupId: string | null = null): ToggleGroup => ({
  id, scenarioId: "s1", name: `Group ${id}`, defaultOn, requiresGroupId, orderIndex: 0,
});

describe("switchedOffGroupNames", () => {
  it("names each group the Solver's tree runs without: off itself, or under an off parent", () => {
    expect(
      switchedOffGroupNames([group("a", false), group("b", true, "a"), group("c", true), group("d", true, "c")]),
    ).toEqual({ a: "Group a", b: "Group b" });
  });
});
