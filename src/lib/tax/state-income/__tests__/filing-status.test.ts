import { describe, it, expect } from "vitest";
import { mapFilingStatus } from "../filing-status";

describe("mapFilingStatus", () => {
  it("maps married_joint → joint by default", () => {
    expect(mapFilingStatus("married_joint")).toBe("joint");
  });
  it("maps single → single", () => {
    expect(mapFilingStatus("single")).toBe("single");
  });
  it("maps head_of_household → single by default", () => {
    expect(mapFilingStatus("head_of_household")).toBe("single");
  });
  it("maps married_separate → single by default", () => {
    expect(mapFilingStatus("married_separate")).toBe("single");
  });
  it("respects per-state overrides", () => {
    // hypothetical state that puts HOH on joint brackets
    expect(
      mapFilingStatus("head_of_household", { head_of_household: "joint" }),
    ).toBe("joint");
  });
});
