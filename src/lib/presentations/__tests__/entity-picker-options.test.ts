import { describe, it, expect } from "vitest";
import { mapAccountBusinessTypeToEntityType } from "../entity-picker-options";

describe("mapAccountBusinessTypeToEntityType", () => {
  it("passes through known business entity types", () => {
    expect(mapAccountBusinessTypeToEntityType("llc")).toBe("llc");
    expect(mapAccountBusinessTypeToEntityType("s_corp")).toBe("s_corp");
    expect(mapAccountBusinessTypeToEntityType("c_corp")).toBe("c_corp");
    expect(mapAccountBusinessTypeToEntityType("partnership")).toBe("partnership");
  });

  it("folds sole_prop / other / nullish to 'other'", () => {
    expect(mapAccountBusinessTypeToEntityType("sole_prop")).toBe("other");
    expect(mapAccountBusinessTypeToEntityType("other")).toBe("other");
    expect(mapAccountBusinessTypeToEntityType(null)).toBe("other");
    expect(mapAccountBusinessTypeToEntityType(undefined)).toBe("other");
  });
});
