import { describe, it, expect } from "vitest";
import { buildTargetNames } from "../load-panel-data";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";
import type { ClientData } from "@/engine/types";

describe("buildTargetNames", () => {
  it("names a saved stress test by its stored title", () => {
    const id = STRESS_TEST_IDS["market-crash"];
    const tree = {
      stressTests: [{ kind: "market-crash", year: 2027, drawdownPct: 0.3, id, name: "Market crash — 30% in 2027" }],
    } as unknown as ClientData;
    expect(buildTargetNames(tree, "c1")[`stress_test:${id}`]).toBe("Market crash — 30% in 2027");
  });
});
