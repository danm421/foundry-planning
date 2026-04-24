import { describe, it, expect } from "vitest";
import { computeHypotheticalEstateTax } from "../hypothetical-estate-tax";

describe("computeHypotheticalEstateTax", () => {
  it("is wired up", () => {
    expect(computeHypotheticalEstateTax).toBeDefined();
  });
});
