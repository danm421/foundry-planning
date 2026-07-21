import { describe, it, expect } from "vitest";
import type { AssembleState } from "../types";

describe("AssembleState", () => {
  it("shapes an assemble sub-state", () => {
    const s: AssembleState = {
      version: 1, mergedFileCount: 3, assumptions: [], questions: [],
    };
    expect(s.version).toBe(1);
  });
});
